/**
 * Reads one species out of the Cobblemon cache that `cobblemon-assets`
 * extracts (`.cobblemon-cache/<species>/`): the mod's own `species.json`,
 * the dex entry with its lang lines, and the spawn pools.
 */

import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import type { SpeciesBehaviour } from "@gotcha/cpkmn";

export const DEFAULT_COBBLEMON_DIR = ".cobblemon-cache";

const requirementSchema = z.object({ variant: z.string() }).passthrough();

const evolutionSchema = z.object({
  id: z.string().optional(),
  variant: z.string(),
  result: z.string(),
  requiredContext: z.string().optional(),
  requirements: z.array(requirementSchema).optional(),
  consumeHeldItem: z.boolean().optional(),
});

const speciesSchema = z.object({
  name: z.string(),
  nationalPokedexNumber: z.number(),
  primaryType: z.string(),
  secondaryType: z.string().nullable().optional(),
  experienceGroup: z.string(),
  baseStats: z.object({ hp: z.number(), attack: z.number(), defence: z.number(), special_attack: z.number(), special_defence: z.number(), speed: z.number() }),
  evolutions: z.array(evolutionSchema).optional(),
  behaviour: z.record(z.string(), z.unknown()).optional(),
  eggGroups: z.array(z.string()).optional(),
  baseFriendship: z.number().optional(),
  catchRate: z.number().optional(),
  baseScale: z.number().optional(),
  pokedex: z.array(z.string()).optional(),
  labels: z.array(z.string()).optional(),
  implemented: z.boolean().optional(),
});

const dexSchema = z.object({ lines: z.record(z.string(), z.string()).optional() });

const spawnFileSchema = z.record(
  z.string(),
  z.object({
    spawns: z
      .array(
        z.object({
          id: z.string().optional(),
          bucket: z.string().optional(),
          spawnablePositionType: z.string().optional(),
          presets: z.array(z.string()).optional(),
          condition: z.object({ biomes: z.array(z.string()).optional(), canSeeSky: z.boolean().optional(), maxSkyLight: z.number().optional(), minSkyLight: z.number().optional() }).passthrough().optional(),
          anticondition: z.object({ biomes: z.array(z.string()).optional() }).passthrough().optional(),
        }),
      )
      .optional(),
  }),
);

const indexSchema = z.object({
  cobblemonVersion: z.string(),
  species: z.record(z.string(), z.object({ name: z.string(), dex: z.number() })),
  skipped: z.record(z.string(), z.string()).optional(),
});

export type CobblemonEvolution = z.infer<typeof evolutionSchema>;
export type CobblemonRequirement = z.infer<typeof requirementSchema>;
export type CobblemonSpeciesJson = z.infer<typeof speciesSchema>;

/** One spawn pool entry reduced to what the habitat table reads. */
export interface SpawnHint {
  biomes: string[];
  antiBiomes: string[];
  /** Grounded spawns that need darkness or a roof: a cave dweller. */
  underground: boolean;
  position: string;
  presets: string[];
}

export interface CobblemonSpecies {
  id: string;
  species: CobblemonSpeciesJson;
  behaviour: SpeciesBehaviour;
  /** Cobblemon's pokedex lines for the base form, resolved from the lang file. */
  pokedexLines: string[];
  /** Every biome tag any spawn pool names, unique and sorted. */
  spawnBiomes: string[];
  spawns: SpawnHint[];
}

export interface CobblemonIndex {
  cobblemonVersion: string;
  species: Record<string, { name: string; dex: number }>;
}

export async function readCobblemonIndex(root = DEFAULT_COBBLEMON_DIR): Promise<CobblemonIndex> {
  const parsed = indexSchema.parse(JSON.parse(await readFile(join(root, "index.json"), "utf8")));
  return { cobblemonVersion: parsed.cobblemonVersion, species: parsed.species };
}

export async function readCobblemonSpecies(id: string, root = DEFAULT_COBBLEMON_DIR): Promise<CobblemonSpecies> {
  const dir = join(root, id);
  const species = speciesSchema.parse(JSON.parse(await readFile(join(dir, "species.json"), "utf8")));
  const dex = dexSchema.parse(JSON.parse(await readOptional(join(dir, "dex.json")) ?? "{}"));
  const spawnFile = spawnFileSchema.parse(JSON.parse(await readOptional(join(dir, "spawn.json")) ?? "{}"));
  return fromJson(id, species, dex.lines ?? {}, spawnFile);
}

/** Pure assembly, exported so tests can feed it inline JSON. */
export function fromJson(id: string, species: CobblemonSpeciesJson, lines: Record<string, string>, spawnFile: z.infer<typeof spawnFileSchema>): CobblemonSpecies {
  const spawns: SpawnHint[] = [];
  for (const file of Object.values(spawnFile)) {
    for (const spawn of file.spawns ?? []) {
      const condition = spawn.condition ?? {};
      const grounded = (spawn.spawnablePositionType ?? "grounded") === "grounded";
      spawns.push({
        biomes: condition.biomes ?? [],
        antiBiomes: spawn.anticondition?.biomes ?? [],
        underground: grounded && (condition.canSeeSky === false || (condition.maxSkyLight !== undefined && condition.maxSkyLight <= 7)),
        position: spawn.spawnablePositionType ?? "grounded",
        presets: spawn.presets ?? [],
      });
    }
  }
  const spawnBiomes = [...new Set(spawns.flatMap((s) => s.biomes))].sort();
  const pokedexLines = (species.pokedex ?? []).map((key) => lines[key]).filter((line): line is string => typeof line === "string" && line.length > 0);
  return { id, species, behaviour: (species.behaviour ?? {}) as SpeciesBehaviour, pokedexLines, spawnBiomes, spawns };
}

async function readOptional(file: string): Promise<string | undefined> {
  try {
    return await readFile(file, "utf8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw err;
  }
}
