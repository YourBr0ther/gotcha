// Shapes of the files the extractor writes. `manifest.json` sits in every
// species folder and is what the renderer reads first; `index.json` sits at
// the cache root and is what a `.cpkmn` manifest's `speciesHash` refers to.

import { z } from "zod";

/** A still texture is a cache path like `textures/eevee.png`; an animated one cycles `frames` at `fps`. */
export const ManifestTextureSchema = z.union([
  z.string(),
  z.object({ fps: z.number(), frames: z.array(z.string()), loop: z.boolean().optional() }),
]);
export type ManifestTexture = z.infer<typeof ManifestTextureSchema>;

export function textureFiles(texture: ManifestTexture | undefined): string[] {
  if (texture === undefined) return [];
  return typeof texture === "string" ? [texture] : texture.frames;
}

export const ManifestLayerSchema = z.object({
  name: z.string().optional(),
  texture: ManifestTextureSchema.optional(),
  emissive: z.boolean().optional(),
  translucent: z.boolean().optional(),
  translucentCull: z.boolean().optional(),
});

/**
 * One resolver variation with jar identifiers rewritten to cache paths.
 * Variations apply in order: a variation matches when every aspect it lists
 * is on the pokemon, and each matching one overrides the fields it sets.
 * The first variation has no aspects and sets everything.
 */
export const ManifestVariationSchema = z.object({
  aspects: z.array(z.string()),
  model: z.string().optional(),
  poser: z.string().optional(),
  texture: ManifestTextureSchema.optional(),
  layers: z.array(ManifestLayerSchema).optional(),
});

export const ClipSchema = z.object({
  length: z.number().optional(),
  loop: z.union([z.boolean(), z.string()]).optional(),
  bones: z.number(),
  /** Keyframe values that are Molang strings rather than numbers. */
  molang: z.number(),
  soundEffects: z.array(z.string()).optional(),
});

export const AnimationGroupSchema = z.object({
  file: z.string(),
  clips: z.record(z.string(), ClipSchema),
});

/** A pose animation is an expression, or one that only applies while `condition` holds. */
export const PoseAnimationSchema = z.union([z.string(), z.object({ animation: z.string(), condition: z.string().optional() })]);
export type PoseAnimation = z.infer<typeof PoseAnimationSchema>;

export const PoseSchema = z.object({
  poseTypes: z.array(z.string()),
  animations: z.array(PoseAnimationSchema),
  quirks: z.array(z.string()),
  namedAnimations: z.record(z.string(), z.string()).optional(),
  condition: z.string().optional(),
  isBattle: z.boolean().optional(),
  isTouchingWater: z.boolean().optional(),
  isUnderWater: z.boolean().optional(),
  transformTicks: z.number().optional(),
  /** `group:clip` pairs the pose's expressions name as literals. */
  clips: z.array(z.string()),
});

export const PoserSummarySchema = z.object({
  /** Cache path of the copied poser JSON; absent when the poser was synthesized. */
  file: z.string().optional(),
  /**
   * True when Cobblemon ships this poser as compiled code rather than JSON
   * and the poses below were built from clip names by convention
   * (standing → ground_idle, walking → ground_walk, sleeping → sleep, and so on).
   */
  synthesized: z.boolean(),
  rootBone: z.string().optional(),
  portraitScale: z.number().optional(),
  portraitTranslation: z.array(z.number()).optional(),
  profileScale: z.number().optional(),
  profileTranslation: z.array(z.number()).optional(),
  /** Top-level `animations` map, e.g. cry → expression. */
  animations: z.record(z.string(), z.string()),
  poses: z.record(z.string(), PoseSchema),
  /** `group:clip` references that no copied animation file defines. */
  unresolvedClips: z.array(z.string()),
});

export const SoundSchema = z.object({
  event: z.string(),
  file: z.string(),
  volume: z.number().optional(),
  pitch: z.number().optional(),
});

export const ManifestSchema = z.object({
  format: z.literal(1),
  species: z.string(),
  name: z.string(),
  dex: z.number(),
  cobblemonVersion: z.string(),
  /** Model identifier (`eevee_male`) → cache path. */
  models: z.record(z.string(), z.string()),
  posers: z.record(z.string(), PoserSummarySchema),
  animations: z.record(z.string(), AnimationGroupSchema),
  variations: z.array(ManifestVariationSchema),
  /** Every aspect any variation can match on. */
  aspects: z.array(z.string()),
  /** Texture basename → cache path, including unreferenced siblings. */
  textures: z.record(z.string(), z.string()),
  sounds: z.record(z.string(), SoundSchema),
  pokedex: z.record(z.string(), z.string()),
  forms: z.array(z.object({ name: z.string(), aspects: z.array(z.string()) })),
  files: z.object({
    species: z.string(),
    dex: z.string().optional(),
    spawn: z.string().optional(),
    license: z.string().optional(),
    resolvers: z.array(z.string()),
  }),
});

export type Manifest = z.infer<typeof ManifestSchema>;
export type ManifestVariation = z.infer<typeof ManifestVariationSchema>;
export type PoserSummary = z.infer<typeof PoserSummarySchema>;
export type Pose = z.infer<typeof PoseSchema>;
export type Clip = z.infer<typeof ClipSchema>;

export const IndexEntrySchema = z.object({
  dex: z.number(),
  name: z.string(),
  hash: z.string(),
  files: z.number(),
  bytes: z.number(),
});

export const IndexSchema = z.object({
  format: z.literal(1),
  cobblemonVersion: z.string(),
  jarSha256: z.string(),
  species: z.record(z.string(), IndexEntrySchema),
  skipped: z.record(z.string(), z.string()),
});

export type Index = z.infer<typeof IndexSchema>;
export type IndexEntry = z.infer<typeof IndexEntrySchema>;

/** JSON with keys sorted at every level, so identical content hashes identically. */
export function stableJson(value: unknown): string {
  return JSON.stringify(sortKeys(value), null, 2) + "\n";
}

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(value as object).sort()) out[key] = sortKeys((value as Record<string, unknown>)[key]);
    return out;
  }
  return value;
}
