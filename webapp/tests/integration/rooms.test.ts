import { describe, it, expect, beforeAll } from "vitest";
import { API_URL, genAuthToken, createRoom, createKeyMaterial, RoomService } from "./helpers";

let reachable = false;

beforeAll(async () => {
  reachable = await fetch(`${API_URL}/v1/health`)
    .then((r) => r.ok)
    .catch(() => false);
  if (!reachable) {
    console.warn(`[integration] Backend not reachable at ${API_URL} — skipping room tests`);
  }
});

describe("Flow 4 — createRoom happy path", () => {
  it("returns 201 with correct response shape", async () => {
    if (!reachable) return;
    const rs = await RoomService.create();
    const result = await rs.createRoom({ name: "Test Room", creatorName: "Alice" });
    expect(result.roomId).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(result.userId).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(result.joinEid).toBe(1);
    expect(result.expiresAt - result.createdAt).toBeCloseTo(10_800_000, -3);
    expect(Math.abs(result.createdAt - Date.now())).toBeLessThan(5000);
  });

  it("two creations produce distinct roomIds", async () => {
    if (!reachable) return;
    const rs = await RoomService.create();
    const r1 = await rs.createRoom({ name: "Room", creatorName: "Alice" });
    const r2 = await rs.createRoom({ name: "Room", creatorName: "Alice" });
    expect(r1.roomId).not.toBe(r2.roomId);
  });
});

describe("Flow 5 — createRoom validation errors", () => {
  // These tests pass raw empty/invalid strings to trigger server-side required-field validation.
  // The service always encrypts, so they call lib/api directly to bypass encryption.
  it("empty name → 400 invalid_body", async () => {
    if (!reachable) return;
    const { publicKeyJwk } = await createKeyMaterial();
    await expect(createRoom({ name: "", publicKey: publicKeyJwk, creatorName: "Alice" })).rejects.toMatchObject({
      status: 400,
      message: "invalid_body",
    });
  });

  it("empty publicKey → 400 invalid_body", async () => {
    if (!reachable) return;
    await expect(createRoom({ name: "Room", publicKey: "", creatorName: "Alice" })).rejects.toMatchObject({
      status: 400,
      message: "invalid_body",
    });
  });

  it("empty creatorName → 400 invalid_body", async () => {
    if (!reachable) return;
    const { publicKeyJwk } = await createKeyMaterial();
    await expect(createRoom({ name: "Room", publicKey: publicKeyJwk, creatorName: "" })).rejects.toMatchObject({
      status: 400,
      message: "invalid_body",
    });
  });
});

describe("Flow 6 — createRoom expiry contract", () => {
  it("expiresAt is in the future", async () => {
    if (!reachable) return;
    const rs = await RoomService.create();
    const result = await rs.createRoom({ name: "Room", creatorName: "Alice" });
    expect(result.expiresAt).toBeGreaterThan(Date.now());
  });
});

describe("Flow 7 — getRoom happy path", () => {
  it("returns correct room shape after creation", async () => {
    if (!reachable) return;
    const rs = await RoomService.create();
    await rs.createRoom({ name: "My Room", creatorName: "Alice" });
    const room = await rs.getRoom();

    expect(room.name).toBe("My Room");
    expect(room.memberCount).toBe(1);
    expect(room.maxParticipants).toBeGreaterThan(0);
    expect(room.maxEvents).toBeGreaterThan(0);
    expect(room.members).toHaveLength(1);
    expect(room.expiresAt).toBeGreaterThan(Date.now());
  });
});

describe("Flow 7b — getRoom includes left members with timestamps", () => {
  it("active member has joinedAt; left member has both joinedAt and leftAt", async () => {
    if (!reachable) return;
    const rs = await RoomService.create();
    const createResult = await rs.createRoom({ name: "Members Test", creatorName: "Alice" });
    const aliceId = createResult.userId;

    const joinResult = await rs.joinRoom({ name: "Bob" });
    const bobId = joinResult.userId;

    // Bob explicitly leaves
    const bobToken = await rs.makeToken(bobId);
    await fetch(`${API_URL}/v1/rooms/${createResult.roomId}/members/me`, {
      method: "DELETE",
      headers: { "X-TempChat-Auth": bobToken },
    });

    // Alice fetches the room
    const aliceToken = await rs.makeToken(aliceId);
    const res = await fetch(`${API_URL}/v1/rooms/${createResult.roomId}`, {
      headers: { "X-TempChat-Auth": aliceToken },
    });
    const room = await res.json();

    expect(room.members).toHaveLength(2);

    const alice = room.members.find((m: { uid: string }) => m.uid === aliceId);
    const bob = room.members.find((m: { uid: string }) => m.uid === bobId);

    expect(alice).toBeDefined();
    expect(alice.joinedAt).toBeGreaterThan(0);
    expect(alice.leftAt).toBeUndefined();

    expect(bob).toBeDefined();
    expect(bob.joinedAt).toBeGreaterThan(0);
    expect(bob.leftAt).toBeGreaterThan(0);
    expect(bob.leftAt).toBeGreaterThanOrEqual(bob.joinedAt);
  });

  it("memberCount includes members who have left", async () => {
    if (!reachable) return;
    const rs = await RoomService.create();
    const createResult = await rs.createRoom({ name: "Count Test", creatorName: "Alice" });

    const joinResult = await rs.joinRoom({ name: "Bob" });
    const bobToken = await rs.makeToken(joinResult.userId);
    await fetch(`${API_URL}/v1/rooms/${createResult.roomId}/members/me`, {
      method: "DELETE",
      headers: { "X-TempChat-Auth": bobToken },
    });

    const room = await rs.getRoom();
    expect(room.memberCount).toBe(2);
    expect(room.members).toHaveLength(2);
  });
});

describe("Flow 8 — getRoom errors", () => {
  it("missing auth header → 401 missing_auth", async () => {
    if (!reachable) return;
    const rs = await RoomService.create();
    const result = await rs.createRoom({ name: "Room", creatorName: "Alice" });
    const res = await fetch(`${API_URL}/v1/rooms/${result.roomId}`);
    expect(res.status).toBe(401);
    expect((await res.json()).error).toBe("missing_auth");
  });

  it("non-existent roomId → 404 room_not_found", async () => {
    if (!reachable) return;
    const { privateKey } = await createKeyMaterial();
    const fakeRoomId = "nonexistent-room-id";
    const token = await genAuthToken({ rid: fakeRoomId, uid: null, ts: Date.now() }, privateKey);
    const res = await fetch(`${API_URL}/v1/rooms/${fakeRoomId}`, {
      headers: { "X-TempChat-Auth": token },
    });
    expect(res.status).toBe(404);
    expect((await res.json()).error).toBe("room_not_found");
  });
});
