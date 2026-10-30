// Index of where each species' pieces live inside the jar. Built once per
// run from the resolvers, species data and the small registries
// (sounds.json, en_us.json), so the extractor can look up identifiers like
// `cobblemon:eevee_male.geo` without guessing folder names.

import { z } from "zod";
import type { JarReader } from "./jar.js";

export const PREFIX = {
  models: "assets/cobblemon/bedrock/pokemon/models/",
  animations: "assets/cobblemon/bedrock/pokemon/animations/",
  posers: "assets/cobblemon/bedrock/pokemon/posers/",
  resolvers: "assets/cobblemon/bedrock/pokemon/resolvers/",
  textures: "assets/cobblemon/textures/pokemon/",
  sounds: "assets/cobblemon/sounds/pokemon/",
  species: "data/cobblemon/species/",
  dexEntries: "data/cobblemon/dex_entries/pokemon/",
  spawns: "data/cobblemon/spawn_pool_world/",
  molang: "data/cobblemon/molang/",
} as const;

export const SOUNDS_JSON = "assets/cobblemon/sounds.json";
export const LANG_JSON = "assets/cobblemon/lang/en_us.json";
export const MOD_JSON = "fabric.mod.json";

/** Cobblemon flips through `frames` at `fps`; a plain string is a single still texture. */
export const AnimatedTextureSchema = z.object({
  fps: z.number(),
  frames: z.array(z.string()),
  loop: z.boolean().optional(),
});

export const TextureRefSchema = z.union([z.string(), AnimatedTextureSchema]);
export type TextureRef = z.infer<typeof TextureRefSchema>;

export function textureFrames(ref: TextureRef | undefined): string[] {
  if (ref === undefined) return [];
  return typeof ref === "string" ? [ref] : ref.frames;
}

/** A few resolvers write `"emissive": "true"`; read the string form too. */
export const LooseBoolean = z.union([z.boolean(), z.string()]).transform((v) => v === true || v === "true");

export const LayerSchema = z.object({
  name: z.string().optional(),
  texture: TextureRefSchema.optional(),
  emissive: LooseBoolean.optional(),
  translucent: LooseBoolean.optional(),
  translucent_cull: LooseBoolean.optional(),
});

export const VariationSchema = z.object({
  aspects: z.array(z.string()).default([]),
  layers: z.array(LayerSchema).optional(),
  model: z.string().optional(),
  poser: z.string().optional(),
  texture: TextureRefSchema.optional(),
});

export const ResolverSchema = z.object({
  order: z.number().default(0),
  species: z.string(),
  variations: z.array(VariationSchema).default([]),
});

export type Resolver = z.infer<typeof ResolverSchema>;
export type Variation = z.infer<typeof VariationSchema>;

export const SpeciesSchema = z.looseObject({
  name: z.string(),
  nationalPokedexNumber: z.number(),
  implemented: z.boolean().optional(),
  pokedex: z.array(z.string()).optional(),
  forms: z.array(z.looseObject({ name: z.string(), aspects: z.array(z.string()).optional() })).optional(),
  behaviour: z.record(z.string(), z.unknown()).optional(),
});

export type SpeciesData = z.infer<typeof SpeciesSchema>;

export const SoundEventSchema = z.looseObject({
  sounds: z.array(
    z.union([z.string(), z.looseObject({ name: z.string(), volume: z.number().optional(), pitch: z.number().optional() })]),
  ),
});

export type SoundEvent = z.infer<typeof SoundEventSchema>;

export interface SpeciesRecord {
  id: string;
  jarPath: string;
  data: SpeciesData;
  resolverPaths: string[];
}

export interface Catalog {
  cobblemonVersion: string;
  species: Map<string, SpeciesRecord>;
  /** Model identifier without namespace or `.json`, e.g. `eevee_male.geo` → jar path. */
  models: Map<string, string>;
  /** Poser identifier, e.g. `eevee` → jar path. */
  posers: Map<string, string>;
  /** Animation group, e.g. `eevee` → jar path of `eevee.animation.json`. */
  animations: Map<string, string>;
  /** Species id → dex entry jar paths. */
  dexEntries: Map<string, string[]>;
  /** Species id → spawn pool jar paths that list the species. */
  spawns: Map<string, string[]>;
  sounds: Map<string, SoundEvent>;
  /** `cobblemon.species.*` keys from en_us.json. */
  lang: Map<string, string>;
}

export function stripNamespace(id: string): string {
  const i = id.indexOf(":");
  return i >= 0 ? id.slice(i + 1) : id;
}

function basename(path: string): string {
  return path.slice(path.lastIndexOf("/") + 1);
}

export function buildCatalog(jar: JarReader): Catalog {
  const cobblemonVersion = readVersion(jar);

  const models = new Map<string, string>();
  for (const path of jar.names(PREFIX.models)) {
    if (!path.endsWith(".geo.json")) continue;
    models.set(basename(path).replace(/\.json$/, ""), path);
  }
  const posers = new Map<string, string>();
  for (const path of jar.names(PREFIX.posers)) {
    if (!path.endsWith(".json")) continue;
    posers.set(basename(path).replace(/\.json$/, ""), path);
  }
  const animations = new Map<string, string>();
  for (const path of jar.names(PREFIX.animations)) {
    if (!path.endsWith(".animation.json")) continue;
    animations.set(basename(path).replace(/\.animation\.json$/, ""), path);
  }

  const resolversBySpecies = new Map<string, { order: number; path: string }[]>();
  for (const path of jar.names(PREFIX.resolvers)) {
    if (!path.endsWith(".json")) continue;
    const parsed = ResolverSchema.safeParse(jar.readJson(path));
    if (!parsed.success) {
      console.warn(`skipping unreadable resolver ${path}: ${parsed.error.issues[0]?.message}`);
      continue;
    }
    const id = stripNamespace(parsed.data.species);
    const list = resolversBySpecies.get(id) ?? [];
    list.push({ order: parsed.data.order, path });
    resolversBySpecies.set(id, list);
  }

  const species = new Map<string, SpeciesRecord>();
  for (const path of jar.names(PREFIX.species)) {
    if (!path.endsWith(".json")) continue;
    const parsed = SpeciesSchema.safeParse(jar.readJson(path));
    if (!parsed.success) {
      console.warn(`skipping unreadable species file ${path}: ${parsed.error.issues[0]?.message}`);
      continue;
    }
    const id = basename(path).replace(/\.json$/, "");
    const resolverPaths = (resolversBySpecies.get(id) ?? [])
      .sort((a, b) => a.order - b.order || a.path.localeCompare(b.path))
      .map((r) => r.path);
    species.set(id, { id, jarPath: path, data: parsed.data, resolverPaths });
  }

  const dexEntries = new Map<string, string[]>();
  for (const path of jar.names(PREFIX.dexEntries)) {
    if (!path.endsWith(".json")) continue;
    const entry = jar.readJson<{ speciesId?: string }>(path);
    const id = entry.speciesId ? stripNamespace(entry.speciesId) : basename(path).replace(/\.json$/, "");
    dexEntries.set(id, [...(dexEntries.get(id) ?? []), path]);
  }

  const spawns = new Map<string, string[]>();
  for (const path of jar.names(PREFIX.spawns)) {
    if (!path.endsWith(".json")) continue;
    const pool = jar.readJson<{ spawns?: { pokemon?: string }[] }>(path);
    const ids = new Set<string>();
    for (const spawn of pool.spawns ?? []) {
      if (typeof spawn.pokemon !== "string") continue;
      // "eevee", "eevee alpha", "pikachu shiny=yes" all name the species first.
      const id = stripNamespace(spawn.pokemon.trim().split(/\s+/)[0]);
      if (id) ids.add(id);
    }
    for (const id of ids) spawns.set(id, [...(spawns.get(id) ?? []), path]);
  }

  const sounds = new Map<string, SoundEvent>();
  if (jar.has(SOUNDS_JSON)) {
    for (const [event, raw] of Object.entries(jar.readJson<Record<string, unknown>>(SOUNDS_JSON))) {
      const parsed = SoundEventSchema.safeParse(raw);
      if (parsed.success) sounds.set(event, parsed.data);
    }
  }

  const lang = new Map<string, string>();
  if (jar.has(LANG_JSON)) {
    for (const [key, text] of Object.entries(jar.readJson<Record<string, string>>(LANG_JSON))) {
      if (key.startsWith("cobblemon.species.") && typeof text === "string") lang.set(key, text);
    }
  }

  return { cobblemonVersion, species, models, posers, animations, dexEntries, spawns, sounds, lang };
}

function readVersion(jar: JarReader): string {
  if (jar.has(MOD_JSON)) {
    const mod = jar.readJson<{ version?: string }>(MOD_JSON);
    if (typeof mod.version === "string") return mod.version;
  }
  return "unknown";
}
