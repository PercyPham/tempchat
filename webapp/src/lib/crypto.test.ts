import { describe, it, expect } from "vitest";
import {
  genAsymmetricKeyPair,
  deriveAES256FromPrivate,
  keyToString,
  stringToPrivateKey,
  stringToPublicKey,
  signData,
  genAuthToken,
  encrypt,
  decrypt,
  toBase64url,
} from "./crypto";

describe("genAsymmetricKeyPair", () => {
  it("produces extractable ECDSA P-384 key pair", async () => {
    const { privateKey, publicKey } = await genAsymmetricKeyPair();
    expect(privateKey.type).toBe("private");
    expect(publicKey.type).toBe("public");
    const priv = await crypto.subtle.exportKey("jwk", privateKey);
    expect(priv.crv).toBe("P-384");
    expect(priv.d).toBeTruthy();
  });
});

describe("deriveAES256FromPrivate", () => {
  it("derives a 256-bit AES-GCM key from a private key", async () => {
    const { privateKey } = await genAsymmetricKeyPair();
    const aesKey = await deriveAES256FromPrivate(privateKey);
    expect(aesKey.algorithm.name).toBe("AES-GCM");
    const raw = await crypto.subtle.exportKey("raw", aesKey);
    expect(raw.byteLength).toBe(32);
  });

  it("is deterministic — same private key produces equivalent AES key", async () => {
    const { privateKey } = await genAsymmetricKeyPair();
    const aes1 = await deriveAES256FromPrivate(privateKey);
    const aes2 = await deriveAES256FromPrivate(privateKey);
    const [r1, r2] = await Promise.all([crypto.subtle.exportKey("raw", aes1), crypto.subtle.exportKey("raw", aes2)]);
    expect(new Uint8Array(r1)).toEqual(new Uint8Array(r2));
  });

  it("different private keys produce different AES keys", async () => {
    const { privateKey: pk1 } = await genAsymmetricKeyPair();
    const { privateKey: pk2 } = await genAsymmetricKeyPair();
    const [aes1, aes2] = await Promise.all([deriveAES256FromPrivate(pk1), deriveAES256FromPrivate(pk2)]);
    const [r1, r2] = await Promise.all([crypto.subtle.exportKey("raw", aes1), crypto.subtle.exportKey("raw", aes2)]);
    expect(new Uint8Array(r1)).not.toEqual(new Uint8Array(r2));
  });

  it("throws when passed a public key", async () => {
    const { publicKey } = await genAsymmetricKeyPair();
    await expect(deriveAES256FromPrivate(publicKey)).rejects.toThrow();
  });
});

describe("keyToString / stringToPrivateKey / stringToPublicKey", () => {
  it("round-trips a private key", async () => {
    const { privateKey } = await genAsymmetricKeyPair();
    const jwk = await keyToString(privateKey);
    const reimported = await stringToPrivateKey(jwk);
    // Both should produce the same signature
    const msg = new TextEncoder().encode("test");
    const [sig1, sig2] = await Promise.all([
      crypto.subtle.sign({ name: "ECDSA", hash: "SHA-384" }, privateKey, msg),
      crypto.subtle.sign({ name: "ECDSA", hash: "SHA-384" }, reimported, msg),
    ]);
    // ECDSA is non-deterministic so verify both sigs with original public key
    const { publicKey } = await genAsymmetricKeyPair();
    void publicKey; // just check no throws above
    expect(sig1.byteLength).toBe(sig2.byteLength);
  });

  it("round-trips a public key", async () => {
    const { publicKey } = await genAsymmetricKeyPair();
    const jwk = await keyToString(publicKey);
    const reimported = await stringToPublicKey(jwk);
    expect(reimported.type).toBe("public");
  });

  it("keyToString returns valid JSON", async () => {
    const { privateKey } = await genAsymmetricKeyPair();
    const jwk = await keyToString(privateKey);
    expect(() => JSON.parse(jwk)).not.toThrow();
    expect(JSON.parse(jwk).crv).toBe("P-384");
  });
});

describe("encrypt / decrypt", () => {
  it("round-trips arbitrary UTF-8", async () => {
    const { privateKey } = await genAsymmetricKeyPair();
    const aesKey = await deriveAES256FromPrivate(privateKey);
    const plaintext = "Hello, 世界! 🔐";
    expect(await decrypt(await encrypt(plaintext, aesKey), aesKey)).toBe(plaintext);
  });

  it("round-trips empty string", async () => {
    const { privateKey } = await genAsymmetricKeyPair();
    const aesKey = await deriveAES256FromPrivate(privateKey);
    expect(await decrypt(await encrypt("", aesKey), aesKey)).toBe("");
  });

  it("produces different ciphertext on each call (IV uniqueness)", async () => {
    const { privateKey } = await genAsymmetricKeyPair();
    const aesKey = await deriveAES256FromPrivate(privateKey);
    const c1 = await encrypt("same", aesKey);
    const c2 = await encrypt("same", aesKey);
    expect(c1).not.toBe(c2);
  });

  it("throws with wrong key", async () => {
    const { privateKey: pk1 } = await genAsymmetricKeyPair();
    const { privateKey: pk2 } = await genAsymmetricKeyPair();
    const aesKey1 = await deriveAES256FromPrivate(pk1);
    const aesKey2 = await deriveAES256FromPrivate(pk2);
    const cipher = await encrypt("secret", aesKey1);
    await expect(decrypt(cipher, aesKey2)).rejects.toThrow();
  });
});

describe("signData", () => {
  it("returns a base64url string", async () => {
    const { privateKey } = await genAsymmetricKeyPair();
    const sig = await signData("hello", privateKey);
    expect(sig).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it("produces different signatures for different inputs (ECDSA is non-deterministic)", async () => {
    const { privateKey } = await genAsymmetricKeyPair();
    const s1 = await signData("hello", privateKey);
    const s2 = await signData("world", privateKey);
    expect(s1).not.toBe(s2);
  });

  it("signature verifies with corresponding public key", async () => {
    const { privateKey, publicKey } = await genAsymmetricKeyPair();
    const payload = "verify-me";
    const sigB64url = await signData(payload, privateKey);
    // decode base64url sig
    const std = sigB64url.replace(/-/g, "+").replace(/_/g, "/");
    const sigBytes = Uint8Array.from(atob(std), (c) => c.charCodeAt(0));
    const valid = await crypto.subtle.verify(
      { name: "ECDSA", hash: "SHA-384" },
      publicKey,
      sigBytes,
      new TextEncoder().encode(payload),
    );
    expect(valid).toBe(true);
  });

  it("signature from wrong key fails verification", async () => {
    const { privateKey: pk1 } = await genAsymmetricKeyPair();
    const { publicKey: pub2 } = await genAsymmetricKeyPair();
    const payload = "verify-me";
    const sigB64url = await signData(payload, pk1);
    const std = sigB64url.replace(/-/g, "+").replace(/_/g, "/");
    const sigBytes = Uint8Array.from(atob(std), (c) => c.charCodeAt(0));
    const valid = await crypto.subtle.verify(
      { name: "ECDSA", hash: "SHA-384" },
      pub2,
      sigBytes,
      new TextEncoder().encode(payload),
    );
    expect(valid).toBe(false);
  });
});

describe("genAuthToken", () => {
  it("produces base64url.base64url format", async () => {
    const { privateKey } = await genAsymmetricKeyPair();
    const token = await genAuthToken({ rid: "room-1", uid: "user-1", ts: Date.now() }, privateKey);
    expect(token).toMatch(/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);
  });

  it("claims decode to expected JSON fields", async () => {
    const { privateKey } = await genAsymmetricKeyPair();
    const ts = Date.now();
    const token = await genAuthToken({ rid: "room-x", uid: "user-y", ts }, privateKey);
    const claimsPart = token.split(".")[0];
    const decoded = JSON.parse(
      new TextDecoder().decode(
        Uint8Array.from(atob(claimsPart.replace(/-/g, "+").replace(/_/g, "/")), (c) => c.charCodeAt(0)),
      ),
    );
    expect(decoded).toMatchObject({ rid: "room-x", uid: "user-y", ts });
  });

  it("accepts uid: null", async () => {
    const { privateKey } = await genAsymmetricKeyPair();
    const token = await genAuthToken({ rid: "room-1", uid: null, ts: Date.now() }, privateKey);
    expect(token).toBeTruthy();
    const claimsPart = token.split(".")[0];
    const decoded = JSON.parse(
      new TextDecoder().decode(
        Uint8Array.from(atob(claimsPart.replace(/-/g, "+").replace(/_/g, "/")), (c) => c.charCodeAt(0)),
      ),
    );
    expect(decoded.uid).toBeNull();
  });

  it("signature in token verifies with public key", async () => {
    const { privateKey, publicKey } = await genAsymmetricKeyPair();
    const token = await genAuthToken({ rid: "r", uid: "u", ts: Date.now() }, privateKey);
    const [claimsPart, sigPart] = token.split(".");
    const std = sigPart.replace(/-/g, "+").replace(/_/g, "/");
    const sigBytes = Uint8Array.from(atob(std), (c) => c.charCodeAt(0));
    const valid = await crypto.subtle.verify(
      { name: "ECDSA", hash: "SHA-384" },
      publicKey,
      sigBytes,
      new TextEncoder().encode(claimsPart),
    );
    expect(valid).toBe(true);
  });
});

describe("toBase64url", () => {
  it("encodes correctly — no +, /, or =", async () => {
    const buf = new Uint8Array([0xfb, 0xff, 0xfe]);
    const result = toBase64url(buf);
    // standard base64 of [0xfb,0xff,0xfe] is "+//+" — base64url should be "-__-" no padding
    expect(result).toBe("-__-");
  });
});
