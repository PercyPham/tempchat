import { genAsymmetricKeyPair, deriveAES256FromPrivate, keyToString } from "../lib/crypto";

export interface KeyMaterial {
  privateKey: CryptoKey;
  publicKey: CryptoKey;
  aesKey: CryptoKey;
  publicKeyJwk: string;
}

export async function createKeyMaterial(): Promise<KeyMaterial> {
  const { privateKey, publicKey } = await genAsymmetricKeyPair();
  const aesKey = await deriveAES256FromPrivate(privateKey);
  const publicKeyJwk = await keyToString(publicKey);
  return { privateKey, publicKey, aesKey, publicKeyJwk };
}
