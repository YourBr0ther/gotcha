/**
 * The pokedex cache (`pnpm pokedex:build`, `.pokedex-cache/species/`) as
 * the starter list reads it: one small record per species with the name,
 * dex number, types and preferred dioramas. Without the cache the list
 * falls back to what the Cobblemon cache index knows, so a fresh checkout
 * can still pick a starter.
 */

import { readFile } from "node:fs/promises";
import path from "node:path";
import { pickableSpecies } from "./animation";
import { listSpecies, getSpecies } from "./species";

export interface StarterSpecies {
  id: string;
  name: string;
  dex: number;
  types: string[];
  dioramas: string[];
}

interface PokedexIndex {
  species: Record<string, { name: string; dex: number; dioramas?: string[] }>;
}

interface PokedexBundle {
  pokedex?: { types?: string[] };
}

export function pokedexCacheDir(): string {
  if (process.env.POKEDEX_CACHE_DIR) return path.resolve(process.env.POKEDEX_CACHE_DIR);
  const data = process.env.GOTCHA_DATA_DIR;
  return data ? path.resolve(data, "pokedex-cache") : path.resolve(process.cwd(), ".pokedex-cache");
}

async function readJson<T>(file: string): Promise<T | null> {
  try {
    return JSON.parse(await readFile(file, "utf8")) as T;
  } catch {
    return null;
  }
}

function titleCase(id: string): string {
  return id
    .split("_")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

let listPromise: Promise<StarterSpecies[]> | null = null;

/** Only species the Cobblemon cache has assets for, and that stand and walk with some life, can be starters. */
async function build(): Promise<StarterSpecies[]> {
  const animated = await pickableSpecies();
  const ids = (await listSpecies()).filter((id) => animated.has(id));
  const dir = path.join(pokedexCacheDir(), "species");
  const index = await readJson<PokedexIndex>(path.join(dir, "index.json"));
  const out: StarterSpecies[] = [];
  if (index?.species) {
    await Promise.all(
      ids.map(async (id) => {
        const entry = index.species[id];
        if (!entry) return;
        const bundle = await readJson<PokedexBundle>(path.join(dir, `${id}.json`));
        out.push({ id, name: entry.name || titleCase(id), dex: entry.dex, types: bundle?.pokedex?.types ?? [], dioramas: entry.dioramas ?? [] });
      }),
    );
  } else {
    for (const id of ids) {
      const record = await getSpecies(id).catch(() => null);
      out.push({ id, name: record?.name ?? titleCase(id), dex: record?.nationalDex ?? 0, types: record?.types ?? [], dioramas: [] });
    }
  }
  return out.sort((a, b) => a.dex - b.dex || a.id.localeCompare(b.id));
}

export async function starterSpecies(): Promise<StarterSpecies[]> {
  listPromise ??= build().catch((error) => {
    listPromise = null;
    throw error;
  });
  return listPromise;
}

/** Forget the built list, for tests and a cache rebuild. */
export function resetStarterSpecies(): void {
  listPromise = null;
}
