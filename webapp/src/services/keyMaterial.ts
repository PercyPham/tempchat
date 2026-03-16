import { generateSecret, deriveRak, rak2base64url } from "../lib/crypto";

export interface KeyMaterial {
  secret: CryptoKey;
  rak: CryptoKey;
  accessKey: string; // base64url-encoded RAK
}

export async function createKeyMaterial(): Promise<KeyMaterial> {
  const secret = await generateSecret();
  const rak = await deriveRak(secret);
  const accessKey = await rak2base64url(rak);
  return { secret, rak, accessKey };
}
