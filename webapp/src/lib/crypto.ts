export interface KeyBundle {
  publicKey: CryptoKey;
  privateKey: CryptoKey;
}

const ASYMM_ALGO: EcKeyGenParams = { name: "ECDSA", namedCurve: "P-384" };
const SIGN_ALGO: EcdsaParams = { name: "ECDSA", hash: "SHA-384" };

export async function genAsymmetricKeyPair(): Promise<KeyBundle> {
  const keyPair = await crypto.subtle.generateKey(ASYMM_ALGO, true, ["sign", "verify"]);
  return keyPair as KeyBundle;
}

export async function deriveAES256FromPrivate(privateKey: CryptoKey): Promise<CryptoKey> {
  const jwk = await crypto.subtle.exportKey("jwk", privateKey);
  if (!jwk.d) throw new Error("Key provided is not a private key.");
  const entropy = new TextEncoder().encode(jwk.d);
  const baseKey = await crypto.subtle.importKey("raw", entropy, "HKDF", false, ["deriveKey"]);
  return crypto.subtle.deriveKey(
    {
      name: "HKDF",
      salt: new Uint8Array(16),
      info: new TextEncoder().encode("aes-encryption-layer"),
      hash: "SHA-384",
    },
    baseKey,
    { name: "AES-GCM", length: 256 },
    true,
    ["encrypt", "decrypt"],
  );
}

export async function keyToString(key: CryptoKey): Promise<string> {
  const exported = await crypto.subtle.exportKey("jwk", key);
  return JSON.stringify(exported);
}

export async function stringToPrivateKey(jwkString: string): Promise<CryptoKey> {
  const jwk: JsonWebKey = JSON.parse(jwkString);
  return crypto.subtle.importKey("jwk", jwk, ASYMM_ALGO, true, ["sign"]);
}

export async function stringToPublicKey(jwkString: string): Promise<CryptoKey> {
  const jwk: JsonWebKey = JSON.parse(jwkString);
  return crypto.subtle.importKey("jwk", jwk, ASYMM_ALGO, true, ["verify"]);
}

export function toBase64url(buf: ArrayBuffer | Uint8Array): string {
  return btoa(String.fromCharCode(...new Uint8Array(buf)))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

export async function signData(payload: string, privateKey: CryptoKey): Promise<string> {
  const data = new TextEncoder().encode(payload);
  const signature = await crypto.subtle.sign(SIGN_ALGO, privateKey, data);
  return toBase64url(signature);
}

export async function genAuthToken(
  claims: { rid: string; uid: string | null; ts: number },
  privateKey: CryptoKey,
): Promise<string> {
  const encodedClaims = toBase64url(new TextEncoder().encode(JSON.stringify(claims)));
  const signature = await signData(encodedClaims, privateKey);
  return `${encodedClaims}.${signature}`;
}

export async function encrypt(plaintext: string, aesKey: CryptoKey): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encoded = new TextEncoder().encode(plaintext);
  const ciphertext = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, aesKey, encoded);
  const combined = new Uint8Array(iv.byteLength + ciphertext.byteLength);
  combined.set(iv, 0);
  combined.set(new Uint8Array(ciphertext), iv.byteLength);
  return btoa(String.fromCharCode(...combined));
}

export async function decrypt(ciphertext: string, aesKey: CryptoKey): Promise<string> {
  const combined = Uint8Array.from(atob(ciphertext), (c) => c.charCodeAt(0));
  const iv = combined.slice(0, 12);
  const data = combined.slice(12);
  const plaintext = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, aesKey, data);
  return new TextDecoder().decode(plaintext);
}
