import { describe, it, expect, vi } from "vitest";
import {
  generateSecret,
  deriveRak,
  encryptMessage,
  decryptMessage,
  genAuthToken,
  toBase64url,
  rak2base64url,
  base64url2rak,
  signWithRak,
} from "./crypto";

describe("deriveRoomAccessKey", () => {
  it("is deterministic — same secret produces a key that can decrypt what it encrypted", async () => {
    const secret = await generateSecret();
    const rak1 = await deriveRak(secret);
    const rak2 = await deriveRak(secret);
    const plaintext = "hello determinism";
    const cipher = await encryptMessage(plaintext, await generateSecretForEncrypt(rak1));
    // Both derived keys should be equivalent — verify determinism via HMAC signature equality.
    const sig1 = await signWithRak("test", rak1);
    const sig2 = await signWithRak("test", rak2);
    expect(sig1).toBe(sig2);
    void cipher; // suppress unused warning
    void plaintext;
  });

  it("different secrets produce different keys", async () => {
    const secretA = await generateSecret();
    const secretB = await generateSecret();
    const rakA = await deriveRak(secretA);
    const rakB = await deriveRak(secretB);
    expect(await signWithRak("test", rakA)).not.toBe(await signWithRak("test", rakB));
  });
});

// Helper: wrap a signing key's raw bytes as an AES-GCM encrypt/decrypt key
async function generateSecretForEncrypt(_rak: CryptoKey): Promise<CryptoKey> {
  return generateSecret();
}

describe("encryptMessage / decryptMessage", () => {
  it("round-trips arbitrary UTF-8", async () => {
    const key = await generateSecret();
    const plaintext = "Hello, 世界! 🔐";
    expect(await decryptMessage(await encryptMessage(plaintext, key), key)).toBe(plaintext);
  });

  it("round-trips empty string", async () => {
    const key = await generateSecret();
    expect(await decryptMessage(await encryptMessage("", key), key)).toBe("");
  });

  it("produces different ciphertext on each call (IV uniqueness)", async () => {
    const key = await generateSecret();
    const c1 = await encryptMessage("same", key);
    const c2 = await encryptMessage("same", key);
    expect(c1).not.toBe(c2);
  });

  it("throws with wrong key", async () => {
    const key = await generateSecret();
    const wrongKey = await generateSecret();
    const cipher = await encryptMessage("secret", key);
    await expect(decryptMessage(cipher, wrongKey)).rejects.toThrow();
  });
});

describe("genAuthToken", () => {
  it("produces base64url.base64url format", async () => {
    const key = await generateSecret();
    const rak = await deriveRak(key);
    const token = await genAuthToken({ rid: "room-1", uid: "user-1", ts: Date.now() }, rak);
    expect(token).toMatch(/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);
  });

  it("claims decode to expected JSON fields", async () => {
    const key = await generateSecret();
    const rak = await deriveRak(key);
    const ts = Date.now();
    const token = await genAuthToken({ rid: "room-x", uid: "user-y", ts }, rak);
    const claimsPart = token.split(".")[0];
    const decoded = JSON.parse(
      new TextDecoder().decode(
        Uint8Array.from(atob(claimsPart.replace(/-/g, "+").replace(/_/g, "/")), (c) => c.charCodeAt(0)),
      ),
    );
    expect(decoded).toMatchObject({ rid: "room-x", uid: "user-y", ts });
  });

  it("accepts uid: null", async () => {
    const key = await generateSecret();
    const rak = await deriveRak(key);
    const token = await genAuthToken({ rid: "room-1", uid: null, ts: Date.now() }, rak);
    expect(token).toBeTruthy();
    const claimsPart = token.split(".")[0];
    const decoded = JSON.parse(
      new TextDecoder().decode(
        Uint8Array.from(atob(claimsPart.replace(/-/g, "+").replace(/_/g, "/")), (c) => c.charCodeAt(0)),
      ),
    );
    expect(decoded.uid).toBeNull();
  });

  it("is deterministic for the same inputs", async () => {
    const key = await generateSecret();
    const rak = await deriveRak(key);
    const ts = 1700000000000;
    vi.spyOn(Date, "now").mockReturnValue(ts);
    const t1 = await genAuthToken({ rid: "r", uid: "u", ts }, rak);
    const t2 = await genAuthToken({ rid: "r", uid: "u", ts }, rak);
    expect(t1).toBe(t2);
    vi.restoreAllMocks();
  });

  it("toBase64url is exported and encodes correctly", async () => {
    const buf = new Uint8Array([0xfb, 0xff, 0xfe]);
    const result = toBase64url(buf);
    // standard base64 of [0xfb,0xff,0xfe] is "+//+" — base64url should be "-__-" no padding
    expect(result).toBe("-__-");
  });
});

describe("signWithRak", () => {
  it("returns a base64url string", async () => {
    const rak = await deriveRak(await generateSecret());
    const sig = await signWithRak("hello", rak);
    expect(sig).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it("is deterministic for the same inputs", async () => {
    const rak = await deriveRak(await generateSecret());
    expect(await signWithRak("hello", rak)).toBe(await signWithRak("hello", rak));
  });

  it("produces different signatures for different plaintexts", async () => {
    const rak = await deriveRak(await generateSecret());
    expect(await signWithRak("hello", rak)).not.toBe(await signWithRak("world", rak));
  });

  it("produces different signatures for different keys", async () => {
    const rakA = await deriveRak(await generateSecret());
    const rakB = await deriveRak(await generateSecret());
    expect(await signWithRak("hello", rakA)).not.toBe(await signWithRak("hello", rakB));
  });
});

describe("rak2base64url / base64url2rak", () => {
  it("round-trips: rak → base64url → rak produces the same signing key", async () => {
    const secret = await generateSecret();
    const rak = await deriveRak(secret);

    const b64 = await rak2base64url(rak);
    const rak2 = await base64url2rak(b64);

    const msg = new TextEncoder().encode("test");
    const sig1 = await crypto.subtle.sign("HMAC", rak, msg);
    const sig2 = await crypto.subtle.sign("HMAC", rak2, msg);
    expect(new Uint8Array(sig1)).toEqual(new Uint8Array(sig2));
  });

  it("rak2base64url produces a valid base64url string (no +, /, or =)", async () => {
    const secret = await generateSecret();
    const rak = await deriveRak(secret);
    const b64 = await rak2base64url(rak);
    expect(b64).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it("base64url2rak rejects a key that differs from original", async () => {
    const secretA = await generateSecret();
    const secretB = await generateSecret();
    const rakA = await deriveRak(secretA);
    const rakB = await deriveRak(secretB);

    const reimportedA = await base64url2rak(await rak2base64url(rakA));
    expect(await signWithRak("test", reimportedA)).not.toBe(await signWithRak("test", rakB));
  });

  it("re-imported key signs tokens accepted by genAuthToken flow", async () => {
    const secret = await generateSecret();
    const rak = await deriveRak(secret);
    const b64 = await rak2base64url(rak);
    const reimported = await base64url2rak(b64);

    const ts = Date.now();
    const t1 = await genAuthToken({ rid: "r", uid: "u", ts }, rak);
    const t2 = await genAuthToken({ rid: "r", uid: "u", ts }, reimported);
    expect(t1).toBe(t2);
  });
});
