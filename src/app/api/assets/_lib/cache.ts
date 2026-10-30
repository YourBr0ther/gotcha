/**
 * Where the extracted Cobblemon cache and the pokedex cache live on disk,
 * and the species hash the asset URLs are versioned by.
 *
 * Locally both sit in the repo root (`.cobblemon-cache`, `.pokedex-cache`).
 * In the pod `GOTCHA_DATA_DIR` points at the PVC and they sit under it as
 * `cobblemon-cache` and `pokedex-cache`.
 */

import { readFile, stat } from "node:fs/promises";
import path from "node:path";

export function cobblemonCacheDir(): string {
  const data = process.env.GOTCHA_DATA_DIR;
  return data ? path.resolve(data, "cobblemon-cache") : path.resolve(process.cwd(), ".cobblemon-cache");
}

export function pokedexCacheDir(): string {
  const data = process.env.GOTCHA_DATA_DIR;
  return data ? path.resolve(data, "pokedex-cache") : path.resolve(process.cwd(), ".pokedex-cache");
}

export interface CacheIndexEntry {
  hash: string;
  name: string;
  dex: number;
  bytes?: number;
  files?: number;
}

export interface CacheIndex {
  cobblemonVersion?: string;
  format?: number;
  jarSha256?: string;
  skipped?: Record<string, string>;
  species: Record<string, CacheIndexEntry>;
}

/** The URL-sized form of a species hash: `sha256:6ec83e50...` -> `6ec83e50606812f5`. */
export function shortHash(hash: string): string {
  return hash.replace(/^sha256:/, "").slice(0, 16);
}

let cached: { file: string; mtimeMs: number; value: CacheIndex } | null = null;

/** The cache's index.json, re-read whenever the file changes. Null when the cache is missing. */
export async function readCacheIndex(): Promise<CacheIndex | null> {
  const file = path.join(cobblemonCacheDir(), "index.json");
  try {
    const info = await stat(file);
    if (cached && cached.file === file && cached.mtimeMs === info.mtimeMs) return cached.value;
    const value = JSON.parse(await readFile(file, "utf8")) as CacheIndex;
    if (!value || typeof value.species !== "object") return null;
    cached = { file, mtimeMs: info.mtimeMs, value };
    return value;
  } catch {
    return null;
  }
}

export async function speciesVersion(species: string): Promise<string | undefined> {
  const index = await readCacheIndex();
  const hash = index?.species[species]?.hash;
  return hash ? shortHash(hash) : undefined;
}

export const SPECIES_ID = /^[a-z0-9_-]+$/;
