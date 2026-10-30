/**
 * Species that can dress a diorama as ambient wildlife:
 * `/api/assets/ambient?diorama=forest`.
 *
 * A candidate prefers that diorama in the pokedex cache, has assets in the
 * Cobblemon cache, and is small (baseScale under 1.2). The reply says how
 * each one moves so the world can pick a flier for the air volume and a
 * walker for the ground. Built once per diorama per process.
 */

import { readFile } from "node:fs/promises";
import path from "node:path";
import type { SpeciesBehaviour } from "@gotcha/cpkmn";
import { cobblemonCacheDir, pokedexCacheDir, readCacheIndex } from "../_lib/cache";

const DIORAMAS = new Set(["meadow", "forest", "beach", "cave", "snowfield", "pond"]);
const MAX_SCALE = 1.2;

export interface AmbientCandidate {
  species: string;
  baseScale: number;
  flies: boolean;
  swims: boolean;
  walks: boolean;
}

interface PokedexIndex {
  species: Record<string, { dioramas?: string[] }>;
}

interface SpeciesFile {
  baseScale?: number;
  behaviour?: SpeciesBehaviour;
}

const built = new Map<string, Promise<AmbientCandidate[]>>();

async function readJson<T>(file: string): Promise<T | null> {
  try {
    return JSON.parse(await readFile(file, "utf8")) as T;
  } catch {
    return null;
  }
}

async function build(diorama: string): Promise<AmbientCandidate[]> {
  const [cache, pokedex] = await Promise.all([
    readCacheIndex(),
    readJson<PokedexIndex>(path.join(pokedexCacheDir(), "species", "index.json")),
  ]);
  if (!cache || !pokedex?.species) return [];
  const ids = Object.entries(pokedex.species)
    .filter(([id, entry]) => entry.dioramas?.includes(diorama) && cache.species[id])
    .map(([id]) => id);
  const root = cobblemonCacheDir();
  const out: AmbientCandidate[] = [];
  const files = await Promise.all(ids.map((id) => readJson<SpeciesFile>(path.join(root, id, "species.json"))));
  files.forEach((file, i) => {
    if (!file) return;
    const baseScale = file.baseScale ?? 1;
    if (baseScale >= MAX_SCALE) return;
    const moving = file.behaviour?.moving ?? {};
    const flies = moving.fly?.canFly === true;
    const swims = moving.swim?.canSwimInWater !== false && !moving.swim?.avoidsWater;
    const walks = moving.walk?.canWalk !== false && !moving.walk?.avoidsLand;
    out.push({ species: ids[i], baseScale, flies, swims, walks });
  });
  return out;
}

export async function GET(req: Request): Promise<Response> {
  const diorama = new URL(req.url).searchParams.get("diorama") ?? "";
  if (!DIORAMAS.has(diorama)) {
    return Response.json({ error: "unknown diorama", code: "bad_request" }, { status: 400 });
  }
  let pending = built.get(diorama);
  if (!pending) {
    pending = build(diorama).catch((err) => {
      built.delete(diorama);
      throw err;
    });
    built.set(diorama, pending);
  }
  const candidates = await pending;
  return Response.json({ diorama, candidates }, { headers: { "cache-control": "public, max-age=300" } });
}
