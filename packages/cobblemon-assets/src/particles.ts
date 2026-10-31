// Copies the Bedrock particle effects that pokemon animations reference out
// of the jar into `.cobblemon-cache/particles/`, with the textures they draw
// and an index.json the asset route versions them by.
//
// Additive on purpose: it never touches a species folder or the species
// index.json, so it can run on a cache that is already built (the
// entrypoint does exactly that when a volume predates this step).
//
// Animations name an effect without its namespace (`ghostly_smoke`); the
// definition carries `description.identifier: "cobblemon:ghostly_smoke"`,
// and one file (`misc/spewpa_confetti.json`) lacks the `.particle` infix,
// so definitions are matched on identifier, never on filename. Effects
// ending in `_handler` are Kotlin code in the mod, not JSON; they are listed
// under `skipped`.

import { mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import type { Catalog } from "./catalog.js";
import { hashFolder } from "./hash.js";
import type { JarReader } from "./jar.js";
import { stableJson } from "./manifest.js";

export const PARTICLES_DIR = "particles";
export const PARTICLE_PREFIX = "assets/cobblemon/bedrock/particles/";

/** The slice of a jar the step reads, so tests can hand it a fake. */
export type ParticleJar = Pick<JarReader, "names" | "has" | "read" | "readJson">;

const ParticleFileSchema = z.looseObject({
  particle_effect: z.looseObject({
    description: z.looseObject({
      identifier: z.string(),
      basic_render_parameters: z
        .looseObject({
          material: z.string().optional(),
          texture: z.string().optional(),
        })
        .optional(),
    }),
  }),
});

const AnimationFileSchema = z.looseObject({
  animations: z.record(z.string(), z.looseObject({ particle_effects: z.unknown().optional() })),
});

export interface ParticleReference {
  effect: string;
  /** `<group>:<clip>` of one clip that fires it. */
  clip: string;
}

/** The effect ids one clip's `particle_effects` block names, without namespace, in keyframe order. */
export function effectsInClip(particleEffects: unknown): string[] {
  if (!particleEffects || typeof particleEffects !== "object") return [];
  const out: string[] = [];
  const entries = Object.entries(particleEffects as Record<string, unknown>).sort(([a], [b]) => parseFloat(a) - parseFloat(b));
  for (const [, value] of entries) {
    for (const entry of Array.isArray(value) ? value : [value]) {
      const raw = typeof entry === "string" ? entry : entry && typeof entry === "object" ? (entry as { effect?: unknown }).effect : undefined;
      if (typeof raw !== "string" || raw.length === 0) continue;
      out.push(stripNamespace(raw));
    }
  }
  return out;
}

export function isHandlerEffect(effect: string): boolean {
  return effect.endsWith("_handler");
}

/** Every effect any pokemon animation in the jar fires, with one clip that fires it. */
export function collectParticleReferences(jar: ParticleJar, catalog: Catalog): Map<string, ParticleReference> {
  const refs = new Map<string, ParticleReference>();
  for (const [group, path] of [...catalog.animations].sort(([a], [b]) => a.localeCompare(b))) {
    const parsed = AnimationFileSchema.safeParse(jar.readJson(path));
    if (!parsed.success) continue;
    for (const [fullName, anim] of Object.entries(parsed.data.animations)) {
      const clip = fullName.startsWith("animation.") ? fullName.split(".").slice(2).join(".") || fullName : fullName;
      for (const effect of effectsInClip(anim.particle_effects)) {
        if (!refs.has(effect)) refs.set(effect, { effect, clip: `${group}:${clip}` });
      }
    }
  }
  return refs;
}

export interface ParticleDefinitionRecord {
  jarPath: string;
  material: string | undefined;
  texture: string | undefined;
}

/** Identifier (without namespace) to the definition that declares it. */
export function indexParticleDefinitions(jar: ParticleJar): Map<string, ParticleDefinitionRecord> {
  const out = new Map<string, ParticleDefinitionRecord>();
  for (const path of jar.names(PARTICLE_PREFIX)) {
    if (!path.endsWith(".json")) continue;
    let parsed;
    try {
      parsed = ParticleFileSchema.safeParse(jar.readJson(path));
    } catch {
      continue;
    }
    if (!parsed.success) continue;
    const description = parsed.data.particle_effect.description;
    const id = stripNamespace(description.identifier);
    if (out.has(id)) continue;
    out.set(id, {
      jarPath: path,
      material: description.basic_render_parameters?.material,
      texture: description.basic_render_parameters?.texture,
    });
  }
  return out;
}

/**
 * Where a definition's texture lives in the jar. The reference reads
 * `textures/particles/generic/smoke/smoke` (no extension); the jar keeps the
 * folder as `textures/particle/` (singular). A few point at block textures
 * the jar does not carry (metal_sparks wants wool_colored_white); those
 * resolve to null and the renderer draws a white square.
 */
export function resolveParticleTexture(jar: ParticleJar, texture: string | undefined): string | null {
  if (!texture) return null;
  const bare = stripNamespace(texture).replace(/\.png$/, "");
  const candidates = [
    `assets/cobblemon/${bare.replace(/^textures\/particles\//, "textures/particle/")}.png`,
    `assets/cobblemon/${bare}.png`,
    `assets/minecraft/${bare}.png`,
  ];
  for (const candidate of candidates) if (jar.has(candidate)) return candidate;
  return null;
}

export interface ParticleIndexEntry {
  file: string;
  /** Path under the particles folder, or null when the jar lacks the texture. */
  texture: string | null;
  material: string | undefined;
  /** One `<group>:<clip>` that fires the effect, for `assets:check`-style reading. */
  clip: string;
}

export interface ParticleIndex {
  format: 1;
  cobblemonVersion: string;
  /** `sha256:<hex>` over every file in the folder except this index; the asset route versions URLs by it. */
  hash: string;
  effects: Record<string, ParticleIndexEntry>;
  /** Effects animations name that have no JSON definition, with the reason. */
  skipped: Record<string, string>;
}

export interface ExtractParticlesOptions {
  jar: ParticleJar;
  catalog: Catalog;
  outDir: string;
  log?: (line: string) => void;
}

export async function extractParticles({ jar, catalog, outDir, log = () => {} }: ExtractParticlesOptions): Promise<ParticleIndex> {
  const dir = join(outDir, PARTICLES_DIR);
  const refs = collectParticleReferences(jar, catalog);
  const definitions = indexParticleDefinitions(jar);

  await rm(dir, { recursive: true, force: true });
  await mkdir(join(dir, "textures"), { recursive: true });

  const effects: Record<string, ParticleIndexEntry> = {};
  const skipped: Record<string, string> = {};
  const copiedTextures = new Map<string, string>();
  for (const [effect, ref] of [...refs].sort(([a], [b]) => a.localeCompare(b))) {
    if (isHandlerEffect(effect)) {
      skipped[effect] = `code-side handler (${ref.clip})`;
      continue;
    }
    const def = definitions.get(effect);
    if (!def) {
      skipped[effect] = `no definition in jar (${ref.clip})`;
      log(`particles: skip ${effect}: ${skipped[effect]}`);
      continue;
    }
    const file = `${effect}.json`;
    await writeFile(join(dir, file), jar.read(def.jarPath));
    let texture: string | null = null;
    const jarTexture = resolveParticleTexture(jar, def.texture);
    if (jarTexture) {
      texture = copiedTextures.get(jarTexture) ?? null;
      if (!texture) {
        texture = `textures/${jarTexture.replace(/^assets\/[^/]+\/textures\/(particles?\/)?/, "")}`;
        await mkdir(join(dir, texture, ".."), { recursive: true });
        await writeFile(join(dir, texture), jar.read(jarTexture));
        copiedTextures.set(jarTexture, texture);
      }
    } else if (def.texture) {
      log(`particles: ${effect}: texture ${def.texture} not in jar, renderer will draw it white`);
    }
    effects[effect] = { file, texture, material: def.material, clip: ref.clip };
  }

  const folder = await hashFolder(dir);
  const index: ParticleIndex = { format: 1, cobblemonVersion: catalog.cobblemonVersion, hash: folder.hash, effects, skipped };
  await writeFile(join(dir, "index.json"), stableJson(index));
  log(`particles: ${Object.keys(effects).length} effects, ${copiedTextures.size} textures, ${Object.keys(skipped).length} skipped`);
  return index;
}

function stripNamespace(id: string): string {
  const i = id.indexOf(":");
  return i >= 0 ? id.slice(i + 1) : id;
}
