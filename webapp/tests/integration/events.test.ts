import { describe, it, expect, beforeAll } from "vitest";
import { API_URL, genAuthToken, createKeyMaterial, RoomService, wsConnect, wsNextMessage } from "./helpers";

let reachable = false;

beforeAll(async () => {
  reachable = await fetch(`${API_URL}/v1/health`)
    .then((r) => r.ok)
    .catch(() => false);
  if (!reachable) {
    console.warn(`[integration] Backend not reachable at ${API_URL} — skipping events tests`);
  }
});

describe("Flow 14 — getEvents happy path", () => {
  it("returns at least one event after room creation", async () => {
    if (!reachable) return;
    const rs = await RoomService.create();
    await rs.createRoom({ name: "Events Room", creatorName: "Alice" });
    const events = await rs.getEvents();
    expect(events.length).toBeGreaterThanOrEqual(1);
    const first = events[0];
    expect(first.eid).toBeGreaterThan(0);
    expect(first.ts).toBeGreaterThan(0);
  });

  it("join event has correct shape", async () => {
    if (!reachable) return;
    const rs = await RoomService.create();
    const { userId: aliceId } = await rs.createRoom({ name: "Events Room", creatorName: "Alice" });
    await rs.joinRoom({ name: "Bob" });
    // Fetch as Alice (the creator) so join_eid=1 and both join events are visible
    rs.userId = aliceId;
    const events = await rs.getEvents();
    const joinEvents = events.filter((e) => e.type === "joined");
    expect(joinEvents.length).toBeGreaterThanOrEqual(2); // creator + Bob
    const bobJoin = joinEvents[joinEvents.length - 1];
    expect(bobJoin.uid).toBeTruthy();
    expect(bobJoin.ts).toBeGreaterThan(0);
  });

  it("afterEid cursor returns only newer events", async () => {
    if (!reachable) return;
    const rs = await RoomService.create();
    await rs.createRoom({ name: "Cursor Room", creatorName: "Alice" });
    const firstEvents = await rs.getEvents();
    expect(firstEvents.length).toBeGreaterThanOrEqual(1);
    const pivotEid = firstEvents[firstEvents.length - 1].eid;

    await rs.joinRoom({ name: "Bob" });
    const laterEvents = await rs.getEvents(pivotEid);
    expect(laterEvents.every((e) => e.eid > pivotEid)).toBe(true);
    expect(laterEvents.length).toBeGreaterThanOrEqual(1);
  });

  it("late joiner only sees events from their join_eid onward", async () => {
    // Alice creates the room and sends a WS message before Bob joins.
    // Bob's getEvents (no afterEid) should NOT include Alice's pre-join message.
    if (!reachable) return;
    const rs = await RoomService.create();
    const result = await rs.createRoom({ name: "Late Join Room", creatorName: "Alice" });
    const wsUrl = `${API_URL.replace(/^http/, "ws")}/v1/rooms/${result.roomId}/ws`;

    // Alice connects and sends a message before Bob joins
    const tokenA = await rs.makeToken(rs.userId);
    const wsA = await wsConnect(wsUrl, tokenA);
    const aliceMsgReceived = wsNextMessage(wsA, (m) => m["event"] === "message:received");
    wsA.send(JSON.stringify({ event: "message:send", m: "pre_join_message" }));
    const aliceMsg = await aliceMsgReceived;
    const preBobEid = aliceMsg["eid"] as number;

    // Bob joins after Alice's message
    const bobResult = await rs.joinRoom({ name: "Bob" });
    rs.userId = bobResult.userId;

    // Bob fetches events without afterEid — should only see his join event and later
    const bobEvents = await rs.getEvents();
    expect(bobEvents.every((e) => e.eid >= preBobEid + 1)).toBe(true);
    expect(bobEvents.some((e) => e.type === "joined" && e.uid === bobResult.userId)).toBe(true);

    wsA.close();
  });
});

describe("Flow 15 — getEvents errors", () => {
  it("missing auth header → 401 missing_auth", async () => {
    if (!reachable) return;
    const rs = await RoomService.create();
    const result = await rs.createRoom({ name: "Room", creatorName: "Alice" });
    const res = await fetch(`${API_URL}/v1/rooms/${result.roomId}/events`);
    expect(res.status).toBe(401);
    expect((await res.json()).error).toBe("missing_auth");
  });

  it("non-existent roomId → 404 room_not_found", async () => {
    if (!reachable) return;
    const { rak } = await createKeyMaterial();
    const fakeRoomId = "nonexistent-room-id";
    const token = await genAuthToken({ rid: fakeRoomId, uid: null, ts: Date.now() }, rak);
    const res = await fetch(`${API_URL}/v1/rooms/${fakeRoomId}/events`, {
      headers: { "X-TempChat-Auth": token },
    });
    expect(res.status).toBe(404);
    expect((await res.json()).error).toBe("room_not_found");
  });

  it("non-integer afterEid → 400 invalid_after_eid", async () => {
    if (!reachable) return;
    const rs = await RoomService.create();
    const result = await rs.createRoom({ name: "Room", creatorName: "Alice" });
    const token = await rs.makeToken(rs.userId);
    const res = await fetch(`${API_URL}/v1/rooms/${result.roomId}/events?afterEid=notanumber`, {
      headers: { "X-TempChat-Auth": token },
    });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("invalid_after_eid");
  });
});
