/**
 * Which dioramas a species belongs in.
 *
 * Cobblemon biome tags and the PokeAPI habitat each vote for dioramas with a
 * weight; the top scorers are `preferred`, anything with a vote is `allowed`.
 * `allowed` is never empty (meadow is the fallback) and a species that cannot
 * leave the water only ever gets `pond` and `beach`.
 */

import type { SpeciesBehaviour } from "@gotcha/cpkmn";
import type { SpawnHint } from "./cobblemon.js";

export const DIORAMA_IDS = ["meadow", "forest", "beach", "cave", "snowfield", "pond"] as const;
export type DioramaId = (typeof DIORAMA_IDS)[number];

export interface DioramaChoice {
  preferred: DioramaId[];
  allowed: DioramaId[];
}

type Votes = Partial<Record<DioramaId, number>>;

/** Cobblemon biome tags (and a few raw biome ids that appear in spawn pools) to diorama votes. */
export const BIOME_TAGS: Readonly<Record<string, Votes>> = {
  // broad land
  "#cobblemon:is_overworld": { meadow: 0.25, forest: 0.25 },
  "#aether:is_aether": { meadow: 0.25 },
  "#the_bumblezone:the_bumblezone": { meadow: 0.25 },
  "#cobblemon:is_plains": { meadow: 1 },
  "#cobblemon:is_grassland": { meadow: 1 },
  "#cobblemon:is_floral": { meadow: 1 },
  "#cobblemon:is_temperate": { meadow: 0.75, forest: 0.5 },
  "#cobblemon:is_savanna": { meadow: 1 },
  "#cobblemon:is_hills": { meadow: 0.5, forest: 0.25 },
  "#cobblemon:is_highlands": { meadow: 0.75 },
  "#cobblemon:is_plateau": { meadow: 0.75 },
  "#cobblemon:is_shrubland": { meadow: 0.75 },
  "#cobblemon:is_sky": { meadow: 0.5 },
  "#cobblemon:is_arid": { meadow: 0.5, beach: 0.5 },
  "#cobblemon:is_desert": { beach: 0.75, meadow: 0.25 },
  "#cobblemon:is_badlands": { cave: 0.5, beach: 0.5 },
  "#cobblemon:is_cherry_blossom": { forest: 0.75, meadow: 0.25 },
  "aether:skyroot_meadow": { meadow: 0.75 },
  "the_bumblezone:floral_meadow": { meadow: 0.75 },
  "the_bumblezone:pollinated_fields": { meadow: 0.75 },
  "minecraft:sunflower_plains": { meadow: 1 },
  // forests
  "#cobblemon:is_forest": { forest: 1 },
  "#cobblemon:is_jungle": { forest: 1 },
  "#cobblemon:is_taiga": { forest: 1 },
  "#cobblemon:is_bamboo": { forest: 1 },
  "#cobblemon:is_spooky": { forest: 0.75 },
  "#cobblemon:is_magical": { forest: 0.75 },
  "#cobblemon:is_mushroom": { forest: 0.75 },
  "#cobblemon:is_lush": { forest: 0.5, cave: 0.5 },
  "#cobblemon:nether/is_forest": { forest: 0.5, cave: 0.5 },
  "#cobblemon:nether/is_overgrowth": { forest: 0.5, cave: 0.5 },
  "aether:skyroot_forest": { forest: 0.75 },
  "aether:skyroot_woodland": { forest: 0.75 },
  "aether:skyroot_grove": { forest: 0.75 },
  "minecraft:mushroom_fields": { forest: 0.5, meadow: 0.5 },
  // water
  "#cobblemon:is_ocean": { pond: 0.75, beach: 0.5 },
  "#cobblemon:is_deep_ocean": { pond: 1 },
  "#cobblemon:is_warm_ocean": { pond: 0.75, beach: 0.5 },
  "#cobblemon:is_lukewarm_ocean": { pond: 0.75, beach: 0.5 },
  "#cobblemon:is_cold_ocean": { pond: 0.75, snowfield: 0.25 },
  "#cobblemon:is_frozen_ocean": { pond: 0.5, snowfield: 0.75 },
  "#cobblemon:is_freshwater": { pond: 1 },
  "#cobblemon:is_river": { pond: 1 },
  "#cobblemon:is_swamp": { pond: 0.75, forest: 0.25 },
  "#cobblemon:has_block/mud": { pond: 0.5 },
  "minecraft:frozen_river": { pond: 0.5, snowfield: 0.5 },
  // coasts
  "#cobblemon:is_beach": { beach: 1 },
  "#cobblemon:is_coast": { beach: 1 },
  "#cobblemon:is_tropical_island": { beach: 0.75, forest: 0.25 },
  "#cobblemon:is_island": { beach: 0.75 },
  "minecraft:snowy_beach": { beach: 0.5, snowfield: 0.5 },
  // rock and underground
  "#cobblemon:is_mountain": { cave: 0.75, snowfield: 0.25 },
  "#cobblemon:is_peak": { cave: 0.5, snowfield: 0.5 },
  "#cobblemon:is_dripstone": { cave: 1 },
  "#cobblemon:is_deep_dark": { cave: 1 },
  "#cobblemon:is_volcanic": { cave: 1 },
  "#cobblemon:is_thermal": { cave: 0.75 },
  "#cobblemon:is_end": { cave: 0.75 },
  "#minecraft:is_nether": { cave: 0.75 },
  "#cobblemon:nether/is_basalt": { cave: 0.75 },
  "#cobblemon:nether/is_wasteland": { cave: 0.75 },
  "#cobblemon:nether/is_fungus": { cave: 0.75 },
  "#cobblemon:nether/is_desert": { cave: 0.75 },
  "#cobblemon:nether/is_quartz": { cave: 0.75 },
  "#cobblemon:nether/is_crimson": { cave: 0.75 },
  "#cobblemon:nether/is_warped": { cave: 0.75 },
  "#cobblemon:nether/is_soul_fire": { cave: 0.75 },
  "#cobblemon:nether/is_soul_sand": { cave: 0.75 },
  "#cobblemon:nether/is_mountain": { cave: 0.75 },
  "#cobblemon:nether/is_toxic": { cave: 0.75 },
  "#cobblemon:nether/is_frozen": { cave: 0.5, snowfield: 0.5 },
  "the_bumblezone:howling_constructs": { cave: 0.5 },
  "the_bumblezone:crystal_canyon": { cave: 0.75 },
  "biomesoplenty:crystalline_chasm": { cave: 1 },
  // snow
  "#cobblemon:is_freezing": { snowfield: 1 },
  "#cobblemon:is_snowy": { snowfield: 1 },
  "#cobblemon:is_tundra": { snowfield: 1 },
  "#cobblemon:is_glacial": { snowfield: 1 },
  "#cobblemon:is_cold": { snowfield: 0.75 },
  "#cobblemon:is_snowy_forest": { snowfield: 0.75, forest: 0.5 },
  "#cobblemon:is_snowy_taiga": { snowfield: 0.75, forest: 0.5 },
};

/** PokeAPI habitats (gen 3 only, so many species have none) to diorama votes. These outweigh any single biome tag. */
export const POKEAPI_HABITATS: Readonly<Record<string, Votes>> = {
  cave: { cave: 3 },
  forest: { forest: 3 },
  grassland: { meadow: 3 },
  mountain: { cave: 2, snowfield: 1 },
  "rough-terrain": { cave: 1.5, meadow: 1.5 },
  sea: { pond: 2, beach: 1 },
  urban: { meadow: 2 },
  "waters-edge": { pond: 2, beach: 1 },
  rare: {},
};

/** A grounded spawn that wants darkness or a roof votes for the cave, up to this many times per species. */
const UNDERGROUND_VOTE = 0.5;
const UNDERGROUND_CAP = 2;
/** A diorama is preferred when it scores at least this share of the top score. */
const PREFERRED_RATIO = 0.6;
const PREFERRED_MAX = 3;
export const FALLBACK_DIORAMA: DioramaId = "meadow";
export const WATER_DIORAMAS: readonly DioramaId[] = ["pond", "beach"];

/** True when the species never comes ashore. Cobblemon defaults canWalk and canSwimInWater to true, so only explicit flags count. */
export function isWaterOnly(behaviour: SpeciesBehaviour | undefined): boolean {
  const moving = behaviour?.moving;
  if (!moving) return false;
  if (moving.walk?.avoidsLand === true) return true;
  return moving.swim?.canSwimInWater === true && moving.walk?.canWalk === false && moving.fly?.canFly !== true;
}

export function dioramasFor(spawnBiomes: readonly string[], habitat: string | null | undefined, behaviour?: SpeciesBehaviour, spawns?: readonly SpawnHint[]): DioramaChoice {
  const score = new Map<DioramaId, number>();
  const add = (votes: Votes | undefined, scale = 1) => {
    for (const [id, weight] of Object.entries(votes ?? {}) as Array<[DioramaId, number]>) score.set(id, (score.get(id) ?? 0) + weight * scale);
  };
  for (const tag of new Set(spawnBiomes)) add(BIOME_TAGS[tag]);
  if (habitat) add(POKEAPI_HABITATS[habitat]);
  const underground = (spawns ?? []).filter((s) => s.underground).length;
  if (underground > 0) add({ cave: Math.min(underground, UNDERGROUND_CAP) * UNDERGROUND_VOTE });
  if (behaviour?.moving?.swim?.canSwimInWater === true) add({ pond: 0.5 });

  const waterOnly = isWaterOnly(behaviour);
  const avoidsWater = behaviour?.moving?.swim?.avoidsWater === true && !waterOnly;

  let ranked = [...score.entries()].filter(([, s]) => s > 0).sort((a, b) => b[1] - a[1] || DIORAMA_IDS.indexOf(a[0]) - DIORAMA_IDS.indexOf(b[0]));
  if (waterOnly) ranked = ranked.filter(([id]) => WATER_DIORAMAS.includes(id));

  let allowed = ranked.map(([id]) => id);
  const top = ranked[0]?.[1] ?? 0;
  let preferred = ranked
    .filter(([id, s]) => s >= top * PREFERRED_RATIO && !(avoidsWater && id === "pond"))
    .slice(0, PREFERRED_MAX)
    .map(([id]) => id);

  if (waterOnly) {
    // Both water dioramas, best-scoring first, whether or not a tag voted for them.
    allowed = [...allowed, ...WATER_DIORAMAS.filter((id) => !allowed.includes(id))];
    if (preferred.length === 0) preferred = [allowed[0]];
  } else {
    if (allowed.length === 0) allowed = [FALLBACK_DIORAMA];
    if (preferred.length === 0) preferred = [allowed[0]];
  }
  for (const id of preferred) if (!allowed.includes(id)) allowed.push(id);
  return { preferred, allowed };
}
