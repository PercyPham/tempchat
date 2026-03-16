export async function generateSecret(): Promise<CryptoKey> {
  return crypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, true, ["encrypt", "decrypt"]);
}

const RAK_SALT = new TextEncoder().encode("rak");
const RAK_ITERATIONS = 600_000;

// Derive Room Access Key
export async function deriveRak(secret: CryptoKey): Promise<CryptoKey> {
  const rawSecret = await crypto.subtle.exportKey("raw", secret);
  const baseKey = await crypto.subtle.importKey("raw", rawSecret, "PBKDF2", false, ["deriveKey"]);
  return crypto.subtle.deriveKey(
    {
      name: "PBKDF2",
      salt: RAK_SALT,
      iterations: RAK_ITERATIONS,
      hash: "SHA-512",
    },
    baseKey,
    { name: "HMAC", hash: "SHA-256", length: 256 },
    true,
    ["sign"],
  );
}

export async function encryptMessage(plaintext: string, secret: CryptoKey): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encoded = new TextEncoder().encode(plaintext);
  const ciphertext = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, secret, encoded);
  const combined = new Uint8Array(iv.byteLength + ciphertext.byteLength);
  combined.set(iv, 0);
  combined.set(new Uint8Array(ciphertext), iv.byteLength);
  return btoa(String.fromCharCode(...combined));
}

export async function decryptMessage(ciphertext: string, secret: CryptoKey): Promise<string> {
  const combined = Uint8Array.from(atob(ciphertext), (c) => c.charCodeAt(0));
  const iv = combined.slice(0, 12);
  const data = combined.slice(12);
  const plaintext = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, secret, data);
  return new TextDecoder().decode(plaintext);
}

export function toBase64url(buf: ArrayBuffer | Uint8Array): string {
  return btoa(String.fromCharCode(...new Uint8Array(buf)))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

export async function rak2base64url(rak: CryptoKey): Promise<string> {
  const raw = await crypto.subtle.exportKey("raw", rak);
  return toBase64url(raw);
}

export async function base64url2rak(b64url: string): Promise<CryptoKey> {
  const std = b64url.replace(/-/g, "+").replace(/_/g, "/");
  const raw = Uint8Array.from(atob(std), (c) => c.charCodeAt(0));
  return crypto.subtle.importKey("raw", raw, { name: "HMAC", hash: "SHA-256" }, true, ["sign"]);
}

export async function signWithRak(plaintext: string, rak: CryptoKey): Promise<string> {
  const sigBuf = await crypto.subtle.sign("HMAC", rak, new TextEncoder().encode(plaintext));
  return toBase64url(sigBuf);
}

export async function genAuthToken(
  claims: { rid: string; uid: string | null; ts: number },
  roomAccessKey: CryptoKey,
): Promise<string> {
  const encodedClaims = toBase64url(new TextEncoder().encode(JSON.stringify(claims)));
  const signature = await signWithRak(encodedClaims, roomAccessKey);
  return `${encodedClaims}.${signature}`;
}
