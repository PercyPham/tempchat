import { describe, it, expect, beforeAll } from "vitest";
import { API_URL, RoomService } from "./helpers";

let reachable = false;

beforeAll(async () => {
  reachable = await fetch(`${API_URL}/v1/health`)
    .then((r) => r.ok)
    .catch(() => false);
  if (!reachable) {
    console.warn(`[integration] Backend not reachable at ${API_URL} — skipping leave tests`);
  }
});

async function leaveRoom(apiUrl: string, roomId: string, token: string): Promise<Response> {
  return fetch(`${apiUrl}/v1/rooms/${roomId}/members/me`, {
    method: "DELETE",
    headers: { "X-TempChat-Auth": token },
  });
}

describe("Flow 18 — early room cleanup when all users leave", () => {
  it("single-user room: creator leaves → room is deleted immediately", async () => {
    if (!reachable) return;
    const rs = await RoomService.create();
    const result = await rs.createRoom({ name: "Solo Room", creatorName: "Alice" });

    const leaveToken = await rs.makeToken(result.userId);
    await leaveRoom(API_URL, result.roomId, leaveToken);

    const getToken = await rs.makeToken(result.userId);
    const res = await fetch(`${API_URL}/v1/rooms/${result.roomId}`, {
      headers: { "X-TempChat-Auth": getToken },
    });
    expect(res.status).toBe(404);
    expect((await res.json() as { error: string }).error).toBe("room_not_found");
  });

  it("multi-user room: room persists until last user leaves, then is deleted", async () => {
    if (!reachable) return;
    const rs = await RoomService.create();
    const result = await rs.createRoom({ name: "Duo Room", creatorName: "Alice" });
    const bobResult = await rs.joinRoom({ name: "Bob" });

    // Alice leaves — room should still exist
    const aliceLeaveToken = await rs.makeToken(result.userId);
    await leaveRoom(API_URL, result.roomId, aliceLeaveToken);

    const bobGetToken = await rs.makeToken(bobResult.userId);
    const midRes = await fetch(`${API_URL}/v1/rooms/${result.roomId}`, {
      headers: { "X-TempChat-Auth": bobGetToken },
    });
    expect(midRes.status).toBe(200);

    // Bob leaves — room should now be deleted
    const bobLeaveToken = await rs.makeToken(bobResult.userId);
    await leaveRoom(API_URL, result.roomId, bobLeaveToken);

    const finalToken = await rs.makeToken(result.userId);
    const finalRes = await fetch(`${API_URL}/v1/rooms/${result.roomId}`, {
      headers: { "X-TempChat-Auth": finalToken },
    });
    expect(finalRes.status).toBe(404);
    expect((await finalRes.json() as { error: string }).error).toBe("room_not_found");
  });
});
