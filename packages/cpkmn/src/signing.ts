/**
 * ed25519 signatures over the manifest fields the spec names: pokemonId,
 * exportedAt, assetMode and contents, serialised as RFC 8785 canonical JSON.
 * Because contents carries every member hash, a good signature covers the
 * whole archive once the hashes have been checked.
 */
import { getPublicKeyAsync, signAsync, utils, verifyAsync } from "@noble/ed25519";
import { canonical } from "./canonical";
import { fromBase64, toBase64, utf8Encode } from "./bytes";
import type { Manifest, Verification } from "./types";

export interface Signer {
  keyId: string;
  sign(message: Uint8Array): Promise<Uint8Array>;
}

/** keyId to base64 ed25519 public key, the shape an importer keeps locally. */
export type KnownKeys = Record<string, string>;

/** What `/.well-known/cpkmn-keys.json` serves. */
export interface KeyFile {
  keys: Array<{ keyId: string; alg: "ed25519"; publicKey: string }>;
}

/** A signer for the install's private key, as stored in CPKMN_SIGNING_KEY. */
export function createSigner(privateKeyBase64: string, keyId: string): Signer {
  const privateKey = fromBase64(privateKeyBase64);
  if (privateKey.length !== 32) {
    throw new TypeError(`ed25519 private key must be 32 bytes, got ${privateKey.length}`);
  }
  if (!keyId) throw new TypeError("keyId is required");
  return {
    keyId,
    sign: (message) => signAsync(message, privateKey),
  };
}

/** A fresh 32-byte ed25519 private key, base64, for CPKMN_SIGNING_KEY. */
export function generatePrivateKey(): string {
  return toBase64(utils.randomPrivateKey());
}

export async function publicKeyFromPrivate(privateKeyBase64: string): Promise<string> {
  return toBase64(await getPublicKeyAsync(fromBase64(privateKeyBase64)));
}

export function knownKeysFromKeyFile(file: KeyFile): KnownKeys {
  const out: KnownKeys = {};
  for (const key of file.keys) {
    if (key.alg === "ed25519") out[key.keyId] = key.publicKey;
  }
  return out;
}

export type SignedFields = Pick<Manifest, "pokemonId" | "exportedAt" | "assetMode" | "contents">;

export function signaturePayload(fields: SignedFields): Uint8Array {
  return utf8Encode(
    canonical({
      pokemonId: fields.pokemonId,
      exportedAt: fields.exportedAt,
      assetMode: fields.assetMode,
      contents: fields.contents,
    }),
  );
}

export interface SignatureCheck {
  verification: Verification;
  keyId?: string;
  /** Present when verification is "unverified". */
  reason?: string;
}

export async function checkSignature(manifest: Manifest, knownKeys: KnownKeys = {}): Promise<SignatureCheck> {
  const signature = manifest.signature;
  if (!signature) return { verification: "unsigned" };
  const keyId = signature.keyId;
  if (signature.alg !== "ed25519") {
    return { verification: "unverified", keyId, reason: `unsupported signature algorithm ${String(signature.alg)}` };
  }
  const publicKeyBase64 = knownKeys[keyId];
  if (!publicKeyBase64) return { verification: "unverified", keyId, reason: `unknown key ${keyId}` };
  let ok = false;
  try {
    ok = await verifyAsync(fromBase64(signature.value), signaturePayload(manifest), fromBase64(publicKeyBase64));
  } catch (error) {
    return { verification: "unverified", keyId, reason: `signature could not be checked: ${(error as Error).message}` };
  }
  return ok ? { verification: "verified", keyId } : { verification: "unverified", keyId, reason: "signature does not match" };
}
