import { describe, it, expect, beforeAll } from "vitest";
import { generateSecret, encryptMessage } from "./crypto";

function b64Length(utf8Bytes: number): number {
  return Math.ceil((28 + utf8Bytes) / 3) * 4;
}

describe("AES-GCM ciphertext lengths (for backend limit sizing)", () => {
  let key: CryptoKey;

  beforeAll(async () => { key = await generateSecret(); });

  const cases = [
    { label: "room name — 60 ASCII",           str: "a".repeat(60),    utf8Bytes: 60 },
    { label: "room name — 60 × 2-byte UTF-8",  str: "é".repeat(60),    utf8Bytes: 120 },
    { label: "room name — 60 × 4-byte emoji",  str: "😀".repeat(60),   utf8Bytes: 240 },
    { label: "member name — 32 ASCII",          str: "a".repeat(32),    utf8Bytes: 32 },
    { label: "member name — 32 × 2-byte",       str: "é".repeat(32),    utf8Bytes: 64 },
    { label: "member name — 32 × 4-byte emoji", str: "😀".repeat(32),   utf8Bytes: 128 },
  ];

  for (const c of cases) {
    it(`${c.label} → ${b64Length(c.utf8Bytes)} chars`, async () => {
      const cipher = await encryptMessage(c.str, key);
      console.log(`  ${c.label.padEnd(40)} → ${cipher.length} chars`);
      expect(cipher.length).toBe(b64Length(c.utf8Bytes));
    });
  }
});
