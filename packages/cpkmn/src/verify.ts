import { readArchive } from "./archive";
import type { Warning } from "./errors";
import { checkSignature, type KnownKeys } from "./signing";
import type { Manifest, Verification } from "./types";

export interface VerifyResult {
  verification: Verification;
  keyId?: string;
  /** Why a signed file is "unverified": unknown key, bad signature, or a check that failed. */
  reason?: string;
  manifest: Manifest;
  warnings: Warning[];
}

/**
 * Checks integrity and authorship without building the pokemon: every hash
 * in the manifest must match (or this throws, as unpack would), then the
 * signature is checked against knownKeys.
 */
export async function verify(bytes: Uint8Array, knownKeys: KnownKeys = {}): Promise<VerifyResult> {
  const archive = readArchive(bytes);
  const signature = await checkSignature(archive.manifest, knownKeys);
  return { ...signature, manifest: archive.manifest, warnings: archive.warnings };
}
