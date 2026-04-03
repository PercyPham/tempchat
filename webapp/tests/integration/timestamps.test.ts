import { describe, it, expect, beforeAll } from "vitest";
import { API_URL, RoomService, wsConnect, wsNextMessage } from "./helpers";

let reachable = false;

beforeAll(async () => {
  reachable = await fetch(`${API_URL}/v1/health`)
    .then((r) => r.ok)
    .catch(() => false);
  if (!reachable) {
    console.warn(`[integration] Backend not reachable at ${API_URL} — skipping timestamp tests`);
  }
});

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe("message timestamp accuracy", () => {
  it("ts reflects actual send time, not WebSocket connection time", async () => {
    if (!reachable) return;
    const rs = await RoomService.create();
    const result = await rs.createRoom({ name: "TS Room", creatorName: "Alice" });
    const wsUrl = `${API_URL.replace(/^http/, "ws")}/v1/rooms/${result.roomId}/ws`;
    const token = await rs.makeToken(rs.userId);
    const ws = await wsConnect(wsUrl, token);

    // Wait after connection so connection time and send time are clearly different
    await sleep(500);

    const tBeforeSend = Date.now();
    const received = wsNextMessage(ws, (m) => m["event"] === "message:received");
    ws.send(JSON.stringify({ event: "message:send", m: "timing_test" }));
    const msg = await received;
    const tAfterSend = Date.now();

    // ts must be within the send window, not pinned to connection time
    expect(msg["ts"]).toBeGreaterThanOrEqual(tBeforeSend - 200); // 200ms server-side tolerance
    expect(msg["ts"]).toBeLessThanOrEqual(tAfterSend + 200);
    ws.close();
  });

  it("sequential messages on the same connection have non-decreasing timestamps", async () => {
    if (!reachable) return;
    const rs = await RoomService.create();
    const result = await rs.createRoom({ name: "Seq Room", creatorName: "Alice" });
    const wsUrl = `${API_URL.replace(/^http/, "ws")}/v1/rooms/${result.roomId}/ws`;
    const token = await rs.makeToken(rs.userId);
    const ws = await wsConnect(wsUrl, token);

    const recv1 = wsNextMessage(ws, (m) => m["event"] === "message:received" && m["msg"] === "first");
    ws.send(JSON.stringify({ event: "message:send", m: "first" }));
    const msg1 = await recv1;

    await sleep(150);

    const recv2 = wsNextMessage(ws, (m) => m["event"] === "message:received" && m["msg"] === "second");
    ws.send(JSON.stringify({ event: "message:send", m: "second" }));
    const msg2 = await recv2;

    expect(msg2["eid"]).toBeGreaterThan(msg1["eid"] as number);
    // ts must be non-decreasing; the 150ms gap should produce a clearly later ts
    expect(msg2["ts"]).toBeGreaterThan(msg1["ts"] as number);
    ws.close();
  });

  it("message from earlier-connected user sent after a later-connected user's message has non-decreasing ts", async () => {
    // Regression test for the flaky bug:
    // User B connects first (T_bob). User A connects later (T_alice > T_bob).
    // Alice sends msg 1, Bob sends msg 2 (higher eid).
    // Before the fix: msg2.ts = T_bob < T_alice = msg1.ts → timestamp goes backwards.
    // After the fix: both ts reflect actual send time → msg2.ts >= msg1.ts.
    if (!reachable) return;
    const rs = await RoomService.create();
    const result = await rs.createRoom({ name: "Regression Room", creatorName: "Alice" });
    const wsUrl = `${API_URL.replace(/^http/, "ws")}/v1/rooms/${result.roomId}/ws`;

    const joinResult = await rs.joinRoom({ name: "Bob" });
    const tokenA = await rs.makeToken(result.userId);
    const tokenB = await rs.makeToken(joinResult.userId);

    // Bob connects first
    const wsB = await wsConnect(wsUrl, tokenB);

    // Wait so that Bob's connection time is clearly earlier than Alice's
    await sleep(500);

    // Alice connects later
    const wsA = await wsConnect(wsUrl, tokenA);

    // Alice sends msg 1
    const recv1 = wsNextMessage(wsA, (m) => m["event"] === "message:received" && m["msg"] === "alice_msg");
    wsA.send(JSON.stringify({ event: "message:send", m: "alice_msg" }));
    const msg1 = await recv1;

    await sleep(50);

    // Bob sends msg 2 (higher eid, but Bob's connection is older)
    const recv2 = wsNextMessage(wsB, (m) => m["event"] === "message:received" && m["msg"] === "bob_msg");
    wsB.send(JSON.stringify({ event: "message:send", m: "bob_msg" }));
    const msg2 = await recv2;

    expect(msg2["eid"]).toBeGreaterThan(msg1["eid"] as number);
    // The core assertion: ts must not go backwards despite the eid advancing
    expect(msg2["ts"]).toBeGreaterThanOrEqual(msg1["ts"] as number);
    wsA.close();
    wsB.close();
  });

  it("ts values from getEvents match ts values received over WebSocket", async () => {
    if (!reachable) return;
    const rs = await RoomService.create();
    const result = await rs.createRoom({ name: "Persist Room", creatorName: "Alice" });
    const wsUrl = `${API_URL.replace(/^http/, "ws")}/v1/rooms/${result.roomId}/ws`;
    const token = await rs.makeToken(rs.userId);
    const ws = await wsConnect(wsUrl, token);

    const received = wsNextMessage(ws, (m) => m["event"] === "message:received");
    ws.send(JSON.stringify({ event: "message:send", m: "persist_check" }));
    const wsmsg = await received;
    ws.close();

    // Fetch the stored event via REST
    const events = await rs.getEvents();
    const stored = events.find((e) => e.eid === (wsmsg["eid"] as number));

    expect(stored).toBeDefined();
    // The ts persisted in Redis must equal the ts broadcast over WebSocket
    expect(stored!.ts).toBe(wsmsg["ts"]);
  });
});
