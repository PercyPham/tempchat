import { describe, it, expect, beforeAll } from "vitest";
import { API_URL, genAuthToken, joinRoom, createKeyMaterial, RoomService } from "./helpers";

let reachable = false;

beforeAll(async () => {
  reachable = await fetch(`${API_URL}/v1/health`)
    .then((r) => r.ok)
    .catch(() => false);
  if (!reachable) {
    console.warn(`[integration] Backend not reachable at ${API_URL} — skipping join tests`);
  }
});

describe("Flow 9 — joinRoom happy path", () => {
  it("returns 200 with correct response shape", async () => {
    if (!reachable) return;
    const rs = await RoomService.create();
    await rs.createRoom({ name: "Join Test Room", creatorName: "Alice" });
    const result = await rs.joinRoom({ name: "Bob" });

    expect(result.userId).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(result.joinEid).toBeGreaterThan(1);
    expect(result.room.name).toBe("Join Test Room");
    expect(result.room.memberCount).toBe(2);
    expect(result.room.members).toHaveLength(2);
    expect(result.room.expiresAt).toBeGreaterThan(Date.now());
  });
});

describe("Flow 10 — joinRoom auth rejection", () => {
  it("missing auth header → 401 missing_auth", async () => {
    if (!reachable) return;
    const rs = await RoomService.create();
    const result = await rs.createRoom({ name: "Room", creatorName: "Alice" });
    const res = await fetch(`${API_URL}/v1/rooms/${result.roomId}/join`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "Bob" }),
    });
    expect(res.status).toBe(401);
    expect((await res.json()).error).toBe("missing_auth");
  });

  it("rid mismatch in token → 401 invalid_auth", async () => {
    // Uses a custom token with the wrong rid — must call lib/api joinRoom directly.
    if (!reachable) return;
    const rs = await RoomService.create();
    const result = await rs.createRoom({ name: "Room", creatorName: "Alice" });
    const token = await genAuthToken({ rid: "wrong-room-id", uid: null, ts: Date.now() }, rs.rak);
    await expect(
      joinRoom({ roomId: result.roomId, name: "Bob", token }),
    ).rejects.toMatchObject({
      status: 401,
      message: "invalid_auth",
    });
  });

  it("expired token → 401 invalid_auth", async () => {
    // Uses a custom ts in the past — must call lib/api joinRoom directly.
    if (!reachable) return;
    const rs = await RoomService.create();
    const result = await rs.createRoom({ name: "Room", creatorName: "Alice" });
    const token = await genAuthToken({ rid: result.roomId, uid: null, ts: Date.now() - 10000 }, rs.rak);
    await expect(
      joinRoom({ roomId: result.roomId, name: "Bob", token }),
    ).rejects.toMatchObject({
      status: 401,
      message: "invalid_auth",
    });
  });
});

describe("Flow 11 — joinRoom validation errors", () => {
  it("empty name → 400 invalid_body", async () => {
    // Passes raw empty string to trigger server-side required-field validation.
    if (!reachable) return;
    const rs = await RoomService.create();
    const result = await rs.createRoom({ name: "Room", creatorName: "Alice" });
    const token = await rs.makeToken(null);
    await expect(joinRoom({ roomId: result.roomId, name: "", token })).rejects.toMatchObject({
      status: 400,
      message: "invalid_body",
    });
  });
});

describe("Flow 12 — joinRoom room_not_found", () => {
  it("non-existent roomId → 404 room_not_found", async () => {
    if (!reachable) return;
    const { rak } = await createKeyMaterial();
    const fakeRoomId = "nonexistent-room-id";
    const token = await genAuthToken({ rid: fakeRoomId, uid: null, ts: Date.now() }, rak);
    const res = await fetch(`${API_URL}/v1/rooms/${fakeRoomId}/join`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-TempChat-Auth": token },
      body: JSON.stringify({ name: "Bob" }),
    });
    expect(res.status).toBe(404);
    expect((await res.json()).error).toBe("room_not_found");
  });
});

describe("Flow 13 — joinRoom room_full", () => {
  it("joining past capacity → 403 room_full", async () => {
    if (!reachable) return;
    const rs = await RoomService.create();
    await rs.createRoom({ name: "Full Room", creatorName: "Alice" });

    for (let i = 2; i <= 5; i++) {
      await rs.joinRoom({ name: `User${i}` });
    }

    await expect(rs.joinRoom({ name: "User6" })).rejects.toMatchObject({
      status: 403,
      message: "room_full",
    });
  });
});
