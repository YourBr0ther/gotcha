/**
 * Species facts from the extracted Cobblemon pack at .cobblemon-cache.
 * Minimal on purpose: pokedex-data is building packages/pokedex, which will
 * replace the internals here. The exported shapes are what the rest of the
 * services depend on.
 */

import { readFile } from "node:fs/promises";
import path from "node:path";
import type { ExperienceGroup, Pokedex, StatBlock, SpeciesBehaviour } from "@gotcha/cpkmn";
import { isStoreItemId, type EvolutionRule, type SpeciesFacts } from "@/lib/sim";
import { ServiceError } from "./errors";

export interface SpeciesRecord {
  species: string;
  name: string;
  nationalDex: number;
  types: string[];
  experienceGroup: ExperienceGroup;
  baseFriendship: number;
  baseStats?: StatBlock;
  eggGroups: string[];
  /** Share of males, 0 to 1; -1 means genderless. */
  maleRatio: number;
  /** Regular abilities first; hidden ones are prefixed "h:" in Cobblemon's data and stripped here. */
  abilities: string[];
  hiddenAbilities: string[];
  behaviour?: SpeciesBehaviour;
  pokedexLines: string[];
  evolutions: EvolutionRule[];
  /** Aspects the pack has textures or models for (shiny, female, ...). */
  aspects: string[];
  cobblemonVersion: string;
  /** sha256 of the extracted species folder, the assetPack.speciesHash for reference-mode files. */
  hash: string;
}

export function cacheDir(): string {
  return process.env.COBBLEMON_CACHE_DIR ?? path.resolve(process.cwd(), ".cobblemon-cache");
}

interface CacheIndex {
  cobblemonVersion: string;
  species: Record<string, { dex: number; name: string; hash: string }>;
}

interface CobblemonEvolution {
  id?: string;
  result: string;
  variant: string;
  requiredContext?: string;
  requirements?: Array<{ variant: string; amount?: number; minLevel?: number; [key: string]: unknown }>;
}

interface CobblemonSpecies {
  name: string;
  nationalPokedexNumber: number;
  primaryType: string;
  secondaryType?: string;
  experienceGroup?: string;
  baseFriendship?: number;
  baseStats?: { hp: number; attack: number; defence: number; special_attack: number; special_defence: number; speed: number };
  eggGroups?: string[];
  maleRatio?: number;
  abilities?: string[];
  behaviour?: SpeciesBehaviour;
  evolutions?: CobblemonEvolution[];
  pokedex?: string[];
}

interface CacheManifest {
  aspects?: string[];
  pokedex?: Record<string, string>;
}

const EXPERIENCE_GROUPS: readonly ExperienceGroup[] = ["erratic", "fast", "medium_fast", "medium_slow", "slow", "fluctuating"];

const records = new Map<string, Promise<SpeciesRecord>>();
let indexPromise: Promise<CacheIndex> | null = null;

async function readJson<T>(file: string): Promise<T> {
  return JSON.parse(await readFile(file, "utf8")) as T;
}

async function loadIndex(): Promise<CacheIndex> {
  indexPromise ??= readJson<CacheIndex>(path.join(cacheDir(), "index.json")).catch((error) => {
    indexPromise = null;
    throw error;
  });
  return indexPromise;
}

export async function listSpecies(): Promise<string[]> {
  const index = await loadIndex();
  return Object.keys(index.species).sort();
}

export function normalizeSpecies(input: string): string {
  return input.trim().toLowerCase().replace(/[\s-]+/g, "_");
}

/** Cobblemon "cobblemon:fire_stone" to the store item id "fire_stone". */
function itemIdFromContext(context: string | undefined): string | undefined {
  if (!context) return undefined;
  const id = context.includes(":") ? context.slice(context.indexOf(":") + 1) : context;
  return id;
}

/**
 * Only the evolutions the engine can check become rules. Level, friendship,
 * stone and trade triggers map; anything with a biome, time, move or other
 * world requirement is left out rather than guessed at.
 */
export function evolutionRules(evolutions: readonly CobblemonEvolution[] | undefined): EvolutionRule[] {
  const rules: EvolutionRule[] = [];
  for (const evo of evolutions ?? []) {
    const requirements = evo.requirements ?? [];
    const unsupported = requirements.some((r) => r.variant !== "level" && r.variant !== "friendship");
    if (unsupported) continue;
    const level = requirements.find((r) => r.variant === "level");
    const friendship = requirements.find((r) => r.variant === "friendship");
    const minLevel = typeof level?.minLevel === "number" ? level.minLevel : undefined;
    const to = evo.result;
    switch (evo.variant) {
      case "level_up":
        if (friendship) rules.push({ to, trigger: "friendship", minFriendship: friendship.amount ?? 160, minLevel });
        else if (minLevel !== undefined) rules.push({ to, trigger: "level", minLevel });
        break;
      case "item_interact": {
        const item = itemIdFromContext(evo.requiredContext);
        if (item && isStoreItemId(item)) rules.push({ to, trigger: "item", item, minLevel });
        break;
      }
      case "trade":
        rules.push({ to, trigger: "trade", minLevel });
        break;
      default:
        break;
    }
  }
  return rules;
}

async function loadRecord(species: string): Promise<SpeciesRecord> {
  const index = await loadIndex();
  const entry = index.species[species];
  if (!entry) throw new ServiceError("unknown_species", `no species "${species}" in the Cobblemon pack`);
  const dir = path.join(cacheDir(), species);
  const [data, manifest] = await Promise.all([readJson<CobblemonSpecies>(path.join(dir, "species.json")), readJson<CacheManifest>(path.join(dir, "manifest.json"))]);

  const group = data.experienceGroup && EXPERIENCE_GROUPS.includes(data.experienceGroup as ExperienceGroup) ? (data.experienceGroup as ExperienceGroup) : "medium_fast";
  const abilities = (data.abilities ?? []).filter((a) => !a.startsWith("h:"));
  const hiddenAbilities = (data.abilities ?? []).filter((a) => a.startsWith("h:")).map((a) => a.slice(2));
  const baseStats = data.baseStats
    ? { hp: data.baseStats.hp, atk: data.baseStats.attack, def: data.baseStats.defence, spa: data.baseStats.special_attack, spd: data.baseStats.special_defence, spe: data.baseStats.speed }
    : undefined;
  const pokedexLines = Object.entries(manifest.pokedex ?? {})
    .filter(([key]) => key === `cobblemon.species.${species}.desc`)
    .map(([, line]) => line);

  return {
    species,
    name: data.name ?? entry.name,
    nationalDex: data.nationalPokedexNumber ?? entry.dex,
    types: [data.primaryType, data.secondaryType].filter((t): t is string => typeof t === "string" && t.length > 0),
    experienceGroup: group,
    baseFriendship: typeof data.baseFriendship === "number" ? data.baseFriendship : 70,
    baseStats,
    eggGroups: data.eggGroups ?? [],
    maleRatio: typeof data.maleRatio === "number" ? data.maleRatio : 0.5,
    abilities,
    hiddenAbilities,
    behaviour: data.behaviour,
    pokedexLines,
    evolutions: evolutionRules(data.evolutions),
    aspects: manifest.aspects ?? [],
    cobblemonVersion: index.cobblemonVersion,
    hash: entry.hash,
  };
}

export async function getSpecies(input: string): Promise<SpeciesRecord> {
  const species = normalizeSpecies(input);
  let pending = records.get(species);
  if (!pending) {
    pending = loadRecord(species).catch((error) => {
      records.delete(species);
      throw error;
    });
    records.set(species, pending);
  }
  return pending;
}

/** What the engine needs. */
export function speciesFacts(record: SpeciesRecord): SpeciesFacts {
  return { species: record.species, experienceGroup: record.experienceGroup, evolutions: record.evolutions };
}

/** The pokedex.json snapshot a new pokemon carries. */
export function pokedexSnapshot(record: SpeciesRecord, now: string): Pokedex {
  return {
    species: record.species,
    nationalDex: record.nationalDex,
    types: record.types,
    eggGroups: record.eggGroups,
    cobblemonPokedexLines: record.pokedexLines,
    baseStats: record.baseStats,
    behaviour: record.behaviour,
    sourcedAt: now,
  };
}

/** The species hash the exporter writes for reference-mode files. */
export async function assetPackFor(species: string): Promise<{ cobblemonVersion: string; speciesHash: string }> {
  const record = await getSpecies(species);
  return { cobblemonVersion: record.cobblemonVersion, speciesHash: record.hash };
}
