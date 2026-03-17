import { describe, it, expect, beforeAll } from "vitest";
import { API_URL, genAuthToken, createKeyMaterial } from "./helpers";

let reachable = false;

beforeAll(async () => {
  reachable = await fetch(`${API_URL}/v1/health`)
    .then((r) => r.ok)
    .catch(() => false);
  if (!reachable) {
    console.warn(`[integration] Backend not reachable at ${API_URL} — skipping auth tests`);
  }
});

// Test-only helper: calls the echo-claims endpoint directly (used by Flows 1-3)
async function echoClaims(accessKey: string, token: string) {
  return fetch(`${API_URL}/v1/test/echo-claims`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ accessKey, token }),
  });
}

describe("Flow 1 — valid token round-trip", () => {
  it("server returns parsed claims matching what client signed", async () => {
    if (!reachable) return;

    const { rak, accessKey } = await createKeyMaterial();
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
  // These tests craft deliberately bad tokens (custom ts), so they use genAuthToken directly.
  it("expired token (ts = now - 10) → 401", async () => {
    if (!reachable) return;
    const { rak, accessKey } = await createKeyMaterial();
    const ts = Date.now() - 10000;
    const token = await genAuthToken({ rid: "r", uid: "u", ts }, rak);
    const res = await echoClaims(accessKey, token);
    expect(res.status).toBe(401);
  });

  it("future token (ts = now + 10) → 401", async () => {
    if (!reachable) return;
    const { rak, accessKey } = await createKeyMaterial();
    const ts = Date.now() + 10000;
    const token = await genAuthToken({ rid: "r", uid: "u", ts }, rak);
    const res = await echoClaims(accessKey, token);
    expect(res.status).toBe(401);
  });

  it("tampered signature → 401", async () => {
    if (!reachable) return;
    const { rak, accessKey } = await createKeyMaterial();
    const ts = Date.now();
    const token = await genAuthToken({ rid: "r", uid: "u", ts }, rak);
    const [claims, sig] = token.split(".");
    const tampered = `${claims}.${sig.slice(0, -3)}XXX`;
    const res = await echoClaims(accessKey, tampered);
    expect(res.status).toBe(401);
  });

  it("malformed token (no dot) → 401", async () => {
    if (!reachable) return;
    const { accessKey } = await createKeyMaterial();
    const res = await echoClaims(accessKey, "nodottoken");
    expect(res.status).toBe(401);
  });

  it("empty token → 400 (binding failure)", async () => {
    if (!reachable) return;
    const { accessKey } = await createKeyMaterial();
    const res = await fetch(`${API_URL}/v1/test/echo-claims`, {
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
    const { rak, accessKey } = await createKeyMaterial();
    const ts = Date.now();
    const token = await genAuthToken({ rid: "test-room", uid: null, ts }, rak);

    const res = await echoClaims(accessKey, token);
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.uid).toBeNull();
  });
});
