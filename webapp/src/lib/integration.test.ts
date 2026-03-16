/// <reference types="node" />

import { describe, it, expect, beforeAll } from "vitest";
import { generateSecret, deriveRoomAccessKey, genAuthToken, toBase64url } from "./crypto";

const BACKEND_URL = process.env.BACKEND_URL;
if (!BACKEND_URL) {
  throw new Error("BACKEND_URL is not set. Please set it in your environment variables.");
}

let reachable = false;

beforeAll(async () => {
  reachable = await fetch(`${BACKEND_URL}/v1/health`)
    .then((r) => r.ok)
    .catch(() => false);
  if (!reachable) {
    console.warn(`[integration] Backend not reachable at ${BACKEND_URL} — skipping all integration tests`);
  }
});

async function makeAccessKeyAndRak() {
  const secret = await generateSecret();
  const rak = await deriveRoomAccessKey(secret);
  const rawKey = await crypto.subtle.exportKey("raw", rak);
  const accessKey = toBase64url(rawKey);
  return { rak, accessKey };
}

async function echoClaims(accessKey: string, token: string) {
  return fetch(`${BACKEND_URL}/v1/test/echo-claims`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ accessKey, token }),
  });
}

describe("Flow 1 — valid token round-trip", () => {
  it("server returns parsed claims matching what client signed", async () => {
    if (!reachable) return;

    const { rak, accessKey } = await makeAccessKeyAndRak();
    const ts = Date.now();
    const token = await genAuthToken({ rid: "test-room", uid: "test-user", ts }, rak);

    const res = await echoClaims(accessKey, token);
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.rid).toBe("test-room");
    expect(body.uid).toBe("test-user");
    expect(Math.abs(body.ts - ts)).toBeLessThanOrEqual(1000);
  });
});

describe("Flow 2 — auth rejection cases", () => {
  it("expired token (ts = now - 10) → 401", async () => {
    if (!reachable) return;
    const { rak, accessKey } = await makeAccessKeyAndRak();
    const ts = Date.now() - 10000;
    const token = await genAuthToken({ rid: "r", uid: "u", ts }, rak);
    const res = await echoClaims(accessKey, token);
    expect(res.status).toBe(401);
  });

  it("future token (ts = now + 10) → 401", async () => {
    if (!reachable) return;
    const { rak, accessKey } = await makeAccessKeyAndRak();
    const ts = Date.now() + 10000;
    const token = await genAuthToken({ rid: "r", uid: "u", ts }, rak);
    const res = await echoClaims(accessKey, token);
    expect(res.status).toBe(401);
  });

  it("tampered signature → 401", async () => {
    if (!reachable) return;
    const { rak, accessKey } = await makeAccessKeyAndRak();
    const ts = Date.now();
    const token = await genAuthToken({ rid: "r", uid: "u", ts }, rak);
    const [claims, sig] = token.split(".");
    const tampered = `${claims}.${sig.slice(0, -3)}XXX`;
    const res = await echoClaims(accessKey, tampered);
    expect(res.status).toBe(401);
  });

  it("malformed token (no dot) → 401", async () => {
    if (!reachable) return;
    const { accessKey } = await makeAccessKeyAndRak();
    const res = await echoClaims(accessKey, "nodottoken");
    expect(res.status).toBe(401);
  });

  it("empty token → 400 (binding failure)", async () => {
    if (!reachable) return;
    const { accessKey } = await makeAccessKeyAndRak();
    // empty string fails ShouldBindJSON required validation
    const res = await fetch(`${BACKEND_URL}/v1/test/echo-claims`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ accessKey, token: "" }),
    });
    expect(res.status).toBe(400);
  });
});

describe("Flow 3 — uid: null join token", () => {
  it("server parses uid as null", async () => {
    if (!reachable) return;
    const { rak, accessKey } = await makeAccessKeyAndRak();
    const ts = Date.now();
    const token = await genAuthToken({ rid: "test-room", uid: null, ts }, rak);

    const res = await echoClaims(accessKey, token);
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.uid).toBeNull();
  });
});
