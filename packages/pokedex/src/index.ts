/**
 * @gotcha/pokedex: species facts from Cobblemon's species files and
 * PokeAPI, built once by `pnpm pokedex:build` into `.pokedex-cache/species/`
 * and read back with `loadSpecies`.
 */

import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { SpeciesBundle, SpeciesIndex } from "./types.js";

export { DEFAULT_OUT, build, buildOne } from "./cli.js";
export { DEFAULT_COBBLEMON_DIR, fromJson as cobblemonFromJson, readCobblemonIndex, readCobblemonSpecies } from "./cobblemon.js";
export type { CobblemonEvolution, CobblemonRequirement, CobblemonSpecies, SpawnHint } from "./cobblemon.js";
export { BIOME_TAGS, DIORAMA_IDS, FALLBACK_DIORAMA, POKEAPI_HABITATS, WATER_DIORAMAS, dioramasFor, isWaterOnly } from "./habitats.js";
export type { DioramaChoice, DioramaId } from "./habitats.js";
export { buildSpeciesFacts, convertEvolutions, itemId, splitResult, toExperienceGroup, toStatBlock } from "./merge.js";
export type { BuiltFacts, MergeInput, Merged } from "./merge.js";
export { POKEAPI_NAMES, toCobblemonId, toPokeApiName } from "./names.js";
export { DEFAULT_CACHE_DIR, PokeApiClient, PokeApiError, cleanFlavorText, createPokeApiClient } from "./pokeapi.js";
export type { ChainLink, FetchLike, PokeApiBundle, PokeApiChain, PokeApiClientOptions, PokeApiPokemon, PokeApiSpecies } from "./pokeapi.js";
export type { SpeciesBundle, SpeciesIndex } from "./types.js";

/** Reads one built species bundle; `null` when it has not been built. */
export async function loadSpecies(id: string, dir = ".pokedex-cache/species"): Promise<SpeciesBundle | null> {
  const text = await readOptional(join(dir, `${id.toLowerCase()}.json`));
  return text === undefined ? null : (JSON.parse(text) as SpeciesBundle);
}

export async function loadSpeciesIndex(dir = ".pokedex-cache/species"): Promise<SpeciesIndex | null> {
  const text = await readOptional(join(dir, "index.json"));
  return text === undefined ? null : (JSON.parse(text) as SpeciesIndex);
}

async function readOptional(file: string): Promise<string | undefined> {
  try {
    return await readFile(file, "utf8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw err;
  }
}
