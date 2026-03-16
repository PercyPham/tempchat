import { describe, it, expect, beforeAll } from "vitest";
import { API_URL, API_URL_2, RoomService, wsConnect, wsNextMessage } from "./helpers";

let reachable = false;

beforeAll(async () => {
  reachable = await fetch(`${API_URL}/v1/health`)
    .then((r) => r.ok)
    .catch(() => false);
  if (!reachable) {
    console.warn(`[integration] Backend not reachable at ${API_URL} — skipping WebSocket tests`);
  }
});

describe("Flow 16 — WebSocket messaging", () => {
  it("send message:send → receive message:received broadcast", async () => {
    if (!reachable) return;
    const rs = await RoomService.create();
    const result = await rs.createRoom({ name: "WS Room", creatorName: "Alice" });
    const wsUrl = `${API_URL.replace(/^http/, "ws")}/v1/rooms/${result.roomId}/ws`;
    const token = await rs.makeToken(rs.userId);
    const ws = await wsConnect(wsUrl, token);

    const received = wsNextMessage(ws, (m) => m["event"] === "message:received");
    ws.send(JSON.stringify({ event: "message:send", m: "cipher_blob_test" }));
    const msg = await received;

    expect(msg["eid"]).toBeGreaterThan(0);
    expect(msg["uid"]).toBe(rs.userId);
    expect(msg["msg"]).toBe("cipher_blob_test");
    expect(msg["ts"]).toBeGreaterThan(0);
    ws.close();
  });

  it("client B receives message sent by client A", async () => {
    if (!reachable) return;
    const rs = await RoomService.create();
    const result = await rs.createRoom({ name: "WS Broadcast", creatorName: "Alice" });
    const wsUrl = `${API_URL.replace(/^http/, "ws")}/v1/rooms/${result.roomId}/ws`;

    const joinResult = await rs.joinRoom({ name: "Bob" });
    const tokenA = await rs.makeToken(result.userId);
    const tokenB = await rs.makeToken(joinResult.userId);

    const wsA = await wsConnect(wsUrl, tokenA);
    const wsB = await wsConnect(wsUrl, tokenB);

    const receivedByB = wsNextMessage(wsB, (m) => m["event"] === "message:received");
    wsA.send(JSON.stringify({ event: "message:send", m: "hello_from_alice" }));
    const msg = await receivedByB;

    expect(msg["uid"]).toBe(result.userId);
    expect(msg["msg"]).toBe("hello_from_alice");
    wsA.close();
    wsB.close();
  });

  it("disconnect alone does NOT trigger user:left for other clients", async () => {
    if (!reachable) return;
    const rs = await RoomService.create();
    const result = await rs.createRoom({ name: "WS No Leave", creatorName: "Alice" });
    const wsUrl = `${API_URL.replace(/^http/, "ws")}/v1/rooms/${result.roomId}/ws`;

    const joinResult = await rs.joinRoom({ name: "Bob" });
    const tokenA = await rs.makeToken(result.userId);
    const tokenB = await rs.makeToken(joinResult.userId);

    const wsA = await wsConnect(wsUrl, tokenA);
    const wsB = await wsConnect(wsUrl, tokenB);

    // Close wsA — Bob should NOT receive user:left
    const unexpectedLeft = wsNextMessage(wsB, (m) => m["event"] === "user:left");
    wsA.close();
    await expect(unexpectedLeft).rejects.toThrow("wsNextMessage timed out");
    wsB.close();
  });

  it("explicit DELETE leave → other client receives user:left", async () => {
    if (!reachable) return;
    const rs = await RoomService.create();
    const result = await rs.createRoom({ name: "WS Explicit Leave", creatorName: "Alice" });
    const wsUrl = `${API_URL.replace(/^http/, "ws")}/v1/rooms/${result.roomId}/ws`;

    const joinResult = await rs.joinRoom({ name: "Bob" });
    const tokenA = await rs.makeToken(result.userId);
    const tokenB = await rs.makeToken(joinResult.userId);

    const wsB = await wsConnect(wsUrl, tokenB);
    const leftEvent = wsNextMessage(wsB, (m) => m["event"] === "user:left");

    // Alice explicitly leaves via HTTP
    const leaveToken = await rs.makeToken(result.userId);
    await fetch(`${API_URL}/v1/rooms/${result.roomId}/members/me`, {
      method: "DELETE",
      headers: { "X-TempChat-Auth": leaveToken },
    });

    const msg = await leftEvent;
    expect(msg["uid"]).toBe(result.userId);
    wsB.close();
  });
});

describe("Flow 17 — cross-instance WebSocket fanout", () => {
  // These tests require a second server instance reachable at VITE_API_URL_2.
  // They are skipped (not failed) if that instance is not running.
  let reachable2 = false;

  beforeAll(async () => {
    if (!API_URL_2) return;
    reachable2 = await fetch(`${API_URL_2}/v1/health`)
      .then((r) => r.ok)
      .catch(() => false);
    if (!reachable2) {
      console.warn(`[integration] Instance 2 not reachable at ${API_URL_2} — skipping Flow 17`);
    }
  });

  it("message sent via instance 1 is received by client on instance 2", async () => {
    if (!reachable || !reachable2) return;

    const rs = await RoomService.create();
    const result = await rs.createRoom({ name: "Cross Room", creatorName: "Alice" });
    const joinResult = await rs.joinRoom({ name: "Bob" });

    const wsUrl1 = `${API_URL.replace(/^http/, "ws")}/v1/rooms/${result.roomId}/ws`;
    const wsUrl2 = `${API_URL_2.replace(/^http/, "ws")}/v1/rooms/${result.roomId}/ws`;

    const tokenA = await rs.makeToken(result.userId);
    const tokenB = await rs.makeToken(joinResult.userId);

    const wsA = await wsConnect(wsUrl1, tokenA); // instance 1
    const wsB = await wsConnect(wsUrl2, tokenB); // instance 2

    const receivedByB = wsNextMessage(wsB, (m) => m["event"] === "message:received");
    wsA.send(JSON.stringify({ event: "message:send", m: "cross_instance_hello" }));
    const msg = await receivedByB;

    expect(msg["uid"]).toBe(result.userId);
    expect(msg["msg"]).toBe("cross_instance_hello");
    wsA.close();
    wsB.close();
  });

  it("explicit DELETE on instance 1 → user:left received by client on instance 2", async () => {
    if (!reachable || !reachable2) return;

    const rs = await RoomService.create();
    const result = await rs.createRoom({ name: "Cross Leave", creatorName: "Alice" });
    const joinResult = await rs.joinRoom({ name: "Bob" });

    const wsUrl2 = `${API_URL_2.replace(/^http/, "ws")}/v1/rooms/${result.roomId}/ws`;
    const tokenB = await rs.makeToken(joinResult.userId);

    const wsB = await wsConnect(wsUrl2, tokenB); // instance 2
    const leftEvent = wsNextMessage(wsB, (m) => m["event"] === "user:left");

    // Alice explicitly leaves via HTTP on instance 1
    const leaveToken = await rs.makeToken(result.userId);
    await fetch(`${API_URL}/v1/rooms/${result.roomId}/members/me`, {
      method: "DELETE",
      headers: { "X-TempChat-Auth": leaveToken },
    });

    const msg = await leftEvent;
    expect(msg["uid"]).toBe(result.userId);
    wsB.close();
  });

  it("REST join on instance 1 → user:joined received by WS client on instance 2", async () => {
    if (!reachable || !reachable2) return;

    const rs = await RoomService.create();
    const result = await rs.createRoom({ name: "Cross Join", creatorName: "Alice" });

    const wsUrl2 = `${API_URL_2.replace(/^http/, "ws")}/v1/rooms/${result.roomId}/ws`;
    const tokenA = await rs.makeToken(result.userId);
    const wsA = await wsConnect(wsUrl2, tokenA); // Alice on instance 2

    const joinedEvent = wsNextMessage(wsA, (m) => m["event"] === "user:joined");

    // Bob joins via REST on instance 1
    const bobResult = await rs.joinRoom({ name: "Bob" });

    const msg = await joinedEvent;
    expect(msg["uid"]).toBe(bobResult.userId);
    wsA.close();
  });
});
