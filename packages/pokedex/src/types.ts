import type { IsoDate, Pokedex } from "@gotcha/cpkmn";
import type { DioramaChoice } from "./habitats.js";
import type { BuiltFacts } from "./merge.js";

/** One `.pokedex-cache/species/<id>.json`. */
export interface SpeciesBundle {
  pokedex: Pokedex;
  facts: BuiltFacts;
  dioramas: DioramaChoice;
  /** False when PokeAPI had no entry and everything came from Cobblemon alone. */
  pokeapi: boolean;
  sourcedAt: IsoDate;
}

/** `.pokedex-cache/species/index.json`. */
export interface SpeciesIndex {
  builtAt: IsoDate;
  cobblemonVersion: string;
  species: Record<string, { name: string; dex: number; pokeapi: boolean; dioramas: string[] }>;
}
