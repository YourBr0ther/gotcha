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

/** The folder the particle effects sit in, beside the species folders. */
export const PARTICLES_FOLDER = "particles";

export interface ParticleIndex {
  format?: number;
  hash: string;
  effects: Record<string, { file: string; texture: string | null; material?: string }>;
  skipped?: Record<string, string>;
}

let cachedParticles: { file: string; mtimeMs: number; value: ParticleIndex } | null = null;

/** `particles/index.json`, re-read when it changes. Null when the particle step has not run on this cache. */
export async function readParticleIndex(): Promise<ParticleIndex | null> {
  const file = path.join(cobblemonCacheDir(), PARTICLES_FOLDER, "index.json");
  try {
    const info = await stat(file);
    if (cachedParticles && cachedParticles.file === file && cachedParticles.mtimeMs === info.mtimeMs) return cachedParticles.value;
    const value = JSON.parse(await readFile(file, "utf8")) as ParticleIndex;
    if (!value || typeof value.hash !== "string" || typeof value.effects !== "object") return null;
    cachedParticles = { file, mtimeMs: info.mtimeMs, value };
    return value;
  } catch {
    return null;
  }
}

export async function particlesVersion(): Promise<string | undefined> {
  const index = await readParticleIndex();
  return index ? shortHash(index.hash) : undefined;
}

/** The version a top-level cache folder's URLs carry: a species hash, or the particle folder's. */
export async function folderVersion(folder: string): Promise<string | undefined> {
  return folder === PARTICLES_FOLDER ? particlesVersion() : speciesVersion(folder);
}

export const SPECIES_ID = /^[a-z0-9_-]+$/;
