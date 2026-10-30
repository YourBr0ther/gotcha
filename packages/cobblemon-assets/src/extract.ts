// Copies one species out of the jar into `.cobblemon-cache/<species>/` and
// writes the manifest the renderer reads. Everything Cobblemon authored is
// copied byte for byte; only manifest.json, dex.json and spawn.json are
// generated.

import { mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import { type Catalog, type SpeciesRecord, type TextureRef, type Variation, LooseBoolean, PREFIX, ResolverSchema, stripNamespace, textureFrames } from "./catalog.js";
import { hashFolder, sha256File } from "./hash.js";
import type { JarReader } from "./jar.js";
import {
  type Clip,
  type Index,
  type IndexEntry,
  IndexSchema,
  type Manifest,
  type ManifestTexture,
  type ManifestVariation,
  type Pose,
  type PoseAnimation,
  type PoserSummary,
  stableJson,
} from "./manifest.js";
import { findAnimationReferences, isMolangExpression, walkStrings } from "./molang.js";

/**
 * Pose names Cobblemon's code posers use, with the clip each one plays by
 * convention and the pose types it answers to. Used when a species has no
 * JSON poser. Only poses whose clip exists are emitted.
 */
const CONVENTIONAL_POSES: { name: string; clip: string; fallback?: string; poseTypes: string[]; isBattle?: boolean }[] = [
  { name: "standing", clip: "ground_idle", fallback: "idle", poseTypes: ["STAND", "NONE", "PORTRAIT", "PROFILE"] },
  { name: "walking", clip: "ground_walk", fallback: "ground_idle", poseTypes: ["WALK"] },
  { name: "sleeping", clip: "sleep", poseTypes: ["SLEEP"] },
  { name: "floating", clip: "water_idle", fallback: "ground_idle", poseTypes: ["FLOAT"] },
  { name: "swimming", clip: "water_swim", fallback: "ground_walk", poseTypes: ["SWIM"] },
  { name: "hovering", clip: "air_idle", fallback: "ground_idle", poseTypes: ["HOVER"] },
  { name: "flying", clip: "air_fly", fallback: "air_idle", poseTypes: ["FLY"] },
  { name: "battle_standing", clip: "battle_idle", poseTypes: ["STAND"], isBattle: true },
];
const CONVENTIONAL_ANIMATIONS = ["cry", "faint", "recoil", "physical", "special", "status"];

export class SkipSpecies extends Error {
  constructor(readonly reason: string) {
    super(reason);
  }
}

export interface ExtractOptions {
  jar: JarReader;
  catalog: Catalog;
  outDir: string;
  /** Species ids to extract; everything implemented when omitted. */
  only?: string[];
  log?: (line: string) => void;
}

export interface ExtractResult {
  extracted: string[];
  skipped: Record<string, string>;
  index: Index;
}

export async function extractAll(options: ExtractOptions): Promise<ExtractResult> {
  const { jar, catalog, outDir } = options;
  const log = options.log ?? (() => {});
  const ids = (options.only ?? [...catalog.species.keys()]).sort();
  const extracted: string[] = [];
  const skipped: Record<string, string> = {};

  await mkdir(outDir, { recursive: true });
  for (const id of ids) {
    const record = catalog.species.get(id);
    if (!record) {
      skipped[id] = "no species.json in jar";
      log(`skip ${id}: ${skipped[id]}`);
      continue;
    }
    try {
      await extractSpecies(jar, catalog, record, join(outDir, id));
      extracted.push(id);
    } catch (error) {
      if (error instanceof SkipSpecies) {
        skipped[id] = error.reason;
        await rm(join(outDir, id), { recursive: true, force: true });
        log(`skip ${id}: ${error.reason}`);
      } else {
        throw new Error(`extracting ${id}: ${(error as Error).message}`, { cause: error });
      }
    }
  }

  const index = await writeIndex({ jar, catalog, outDir, extracted, skipped });
  return { extracted, skipped, index };
}

const PoserFileSchema = z.looseObject({
  rootBone: z.string().optional(),
  portraitScale: z.number().optional(),
  portraitTranslation: z.array(z.number()).optional(),
  profileScale: z.number().optional(),
  profileTranslation: z.array(z.number()).optional(),
  animations: z.record(z.string(), z.string()).optional(),
  poses: z
    .record(
      z.string(),
      z.looseObject({
        poseTypes: z.array(z.string()).optional(),
        // One jar poser has a stray object with no `animation`; such entries are dropped.
        animations: z.array(z.union([z.string(), z.looseObject({ animation: z.string().optional(), condition: z.string().optional() })])).optional(),
        quirks: z.array(z.string()).optional(),
        namedAnimations: z.record(z.string(), z.string()).optional(),
        condition: z.string().optional(),
        isBattle: LooseBoolean.optional(),
        isTouchingWater: LooseBoolean.optional(),
        isUnderWater: LooseBoolean.optional(),
        transformTicks: z.number().optional(),
      }),
    )
    .optional(),
});

const AnimationFileSchema = z.looseObject({
  animations: z.record(
    z.string(),
    z.looseObject({
      animation_length: z.number().optional(),
      loop: z.union([z.boolean(), z.string()]).optional(),
      bones: z.record(z.string(), z.unknown()).optional(),
      sound_effects: z.record(z.string(), z.unknown()).optional(),
    }),
  ),
});

async function extractSpecies(jar: JarReader, catalog: Catalog, record: SpeciesRecord, dir: string): Promise<void> {
  const { id, data } = record;
  if (data.implemented !== true) throw new SkipSpecies("species.json marks it not implemented");
  if (record.resolverPaths.length === 0) throw new SkipSpecies("no resolver");

  const variations: Variation[] = [];
  for (const path of record.resolverPaths) {
    variations.push(...ResolverSchema.parse(jar.readJson(path)).variations);
  }
  const base = variations[0];
  if (!base || base.aspects.length > 0 || !base.model) {
    throw new SkipSpecies("first resolver variation does not set a base model");
  }

  const modelIds = new Set<string>();
  const poserIds = new Set<string>();
  const textureIds = new Set<string>();
  for (const v of variations) {
    if (v.model) modelIds.add(stripNamespace(v.model));
    if (v.poser) poserIds.add(stripNamespace(v.poser));
    for (const frame of textureFrames(v.texture)) textureIds.add(frame);
    for (const layer of v.layers ?? []) for (const frame of textureFrames(layer.texture)) textureIds.add(frame);
  }

  // Resolve identifiers to jar paths before writing anything, so a species
  // with a missing piece is skipped cleanly.
  const modelPaths = new Map<string, string>();
  for (const modelId of modelIds) {
    const path = catalog.models.get(modelId);
    if (!path) throw new SkipSpecies(`geometry missing: ${modelId}`);
    modelPaths.set(modelId.replace(/\.geo$/, ""), path);
  }
  // A poser that is not in the jar as JSON is compiled into Cobblemon's own
  // code; the manifest gets a synthesized one built from clip names instead.
  const poserPaths = new Map<string, string | null>();
  for (const poserId of poserIds) poserPaths.set(poserId, catalog.posers.get(poserId) ?? null);
  const texturePaths = new Map<string, string>();
  for (const textureId of textureIds) {
    const path = `assets/cobblemon/${stripNamespace(textureId)}`;
    if (!jar.has(path)) throw new SkipSpecies(`texture missing: ${textureId}`);
    texturePaths.set(textureId, path);
  }

  await rm(dir, { recursive: true, force: true });
  await mkdir(dir, { recursive: true });

  const manifest: Manifest = {
    format: 1,
    species: id,
    name: data.name,
    dex: data.nationalPokedexNumber,
    cobblemonVersion: catalog.cobblemonVersion,
    models: {},
    posers: {},
    animations: {},
    variations: [],
    aspects: [],
    textures: {},
    sounds: {},
    pokedex: {},
    forms: (data.forms ?? []).map((f) => ({ name: f.name, aspects: f.aspects ?? [] })),
    files: { species: "species.json", resolvers: [] },
  };

  // Models, and the license that sits beside them.
  const modelFolders = new Set<string>();
  for (const [modelId, path] of modelPaths) {
    const out = `models/${modelId}.geo.json`;
    await copy(jar, path, dir, out);
    manifest.models[modelId] = out;
    modelFolders.add(path.slice(0, path.lastIndexOf("/") + 1));
  }
  for (const folder of modelFolders) {
    const license = `${folder}license`;
    if (jar.has(license) && !manifest.files.license) {
      await copy(jar, license, dir, "license");
      manifest.files.license = "license";
    }
  }

  // Posers, and the animation groups they reference.
  const animationGroups = new Set<string>();
  const posers = new Map<string, { summary: PoserSummary; refs: string[] }>();
  for (const [poserId, path] of poserPaths) {
    if (path === null) continue;
    const out = `posers/${poserId}.json`;
    await copy(jar, path, dir, out);
    const { summary, groups, refs } = summarisePoser(jar, path, out);
    for (const group of groups) animationGroups.add(group);
    posers.set(poserId, { summary, refs });
  }
  // Also take every animation file that sits in the model's own folder; some
  // clips are referenced only through the top-level `animations` map or by
  // name from code.
  for (const folder of modelFolders) {
    const animationFolder = folder.replace(PREFIX.models, PREFIX.animations);
    for (const path of jar.names(animationFolder)) {
      if (path.endsWith(".animation.json")) animationGroups.add(basename(path).replace(/\.animation\.json$/, ""));
    }
  }
  const definedClips = new Set<string>();
  for (const group of [...animationGroups].sort()) {
    const path = catalog.animations.get(group);
    if (!path) continue; // Posers reference generic groups too; a missing one is reported through unresolvedClips.
    const out = `animations/${group}.animation.json`;
    await copy(jar, path, dir, out);
    const clips = summariseClips(jar, path);
    manifest.animations[group] = { file: out, clips };
    for (const clip of Object.keys(clips)) definedClips.add(`${group}:${clip}`);
  }
  if (Object.keys(manifest.animations).length === 0) throw new SkipSpecies("no animation file found");
  for (const [poserId, path] of poserPaths) {
    if (path !== null) continue;
    const group = pickGroup(poserId, id, Object.keys(manifest.animations));
    const { summary, refs } = synthesizePoser(group, Object.keys(manifest.animations[group].clips));
    posers.set(poserId, { summary, refs });
  }
  for (const [poserId, { summary, refs }] of posers) {
    summary.unresolvedClips = refs.filter((ref) => !definedClips.has(ref)).sort();
    manifest.posers[poserId] = summary;
  }

  // Textures: the referenced ones and their folder siblings.
  // Keyed by path relative to the outermost referenced folder, so a nested
  // folder (spinda's `spots/`) keeps its own namespace.
  const textureOut = new Map<string, string>();
  const allFolders = new Set<string>();
  for (const path of texturePaths.values()) allFolders.add(path.slice(0, path.lastIndexOf("/") + 1));
  const textureFolders = [...allFolders].sort().filter((folder) => ![...allFolders].some((other) => other !== folder && folder.startsWith(other)));
  for (const folder of textureFolders) {
    for (const path of jar.names(folder)) {
      if (!path.endsWith(".png")) continue;
      let name = path.slice(folder.length);
      if (manifest.textures[name] !== undefined) name = `${basename(folder.slice(0, -1))}/${name}`;
      const out = `textures/${name}`;
      await copy(jar, path, dir, out);
      textureOut.set(path, out);
      manifest.textures[name] = out;
    }
  }
  const textureFor = (ref: TextureRef): ManifestTexture => {
    const file = (textureId: string): string => {
      const out = textureOut.get(texturePaths.get(textureId) ?? "");
      if (!out) throw new Error(`texture ${textureId} resolved but not copied`);
      return out;
    };
    return typeof ref === "string" ? file(ref) : { fps: ref.fps, frames: ref.frames.map(file), loop: ref.loop };
  };

  const aspects = new Set<string>();
  for (const v of variations) {
    for (const aspect of v.aspects) aspects.add(aspect);
    const mv: ManifestVariation = { aspects: v.aspects };
    if (v.model) mv.model = manifest.models[stripNamespace(v.model).replace(/\.geo$/, "")];
    if (v.poser) mv.poser = `posers/${stripNamespace(v.poser)}.json`;
    if (v.texture) mv.texture = textureFor(v.texture);
    if (v.layers) {
      mv.layers = v.layers.map((layer) => ({
        name: layer.name,
        texture: layer.texture ? textureFor(layer.texture) : undefined,
        emissive: layer.emissive,
        translucent: layer.translucent,
        translucentCull: layer.translucent_cull,
      }));
    }
    manifest.variations.push(mv);
  }
  manifest.aspects = [...aspects].sort();

  // Sounds: every `pokemon.<id>.*` event in sounds.json. The first sound of
  // an event is `sounds/<kind>.ogg`, later ones `sounds/<kind>_2.ogg` and so on.
  // `pokemon.lycanroc_midday.cry` is a form-specific event; it lands as `midday_cry`.
  for (const [event, sound] of catalog.sounds) {
    let kind: string;
    if (event.startsWith(`pokemon.${id}.`)) kind = event.slice(`pokemon.${id}.`.length);
    else if (event.startsWith(`pokemon.${id}_`)) {
      const rest = event.slice(`pokemon.${id}_`.length);
      const dot = rest.indexOf(".");
      if (dot < 0) continue;
      kind = `${rest.slice(0, dot)}_${rest.slice(dot + 1)}`;
    } else continue;
    for (const [i, entry] of sound.sounds.entries()) {
      const name = typeof entry === "string" ? entry : entry.name;
      const path = `assets/cobblemon/sounds/${stripNamespace(name)}.ogg`;
      if (!jar.has(path)) continue;
      const key = i === 0 ? kind : `${kind}_${i + 1}`;
      const out = `sounds/${key}.ogg`;
      await copy(jar, path, dir, out);
      manifest.sounds[key] = {
        event,
        file: out,
        volume: typeof entry === "string" ? undefined : entry.volume,
        pitch: typeof entry === "string" ? undefined : entry.pitch,
      };
    }
  }

  // Species data, dex lines, spawns, resolvers.
  await copy(jar, record.jarPath, dir, "species.json");
  for (const path of record.resolverPaths) {
    const out = `resolvers/${basename(path)}`;
    await copy(jar, path, dir, out);
    manifest.files.resolvers.push(out);
  }
  for (const [key, text] of catalog.lang) {
    if (key.startsWith(`cobblemon.species.${id}.`) || key.startsWith(`cobblemon.species.${id}-`)) manifest.pokedex[key] = text;
  }
  const dexPaths = catalog.dexEntries.get(id) ?? [];
  if (dexPaths.length > 0) {
    const entries = dexPaths.map((path) => ({ source: basename(path), ...(jar.readJson(path) as object) }));
    await writeFile(join(dir, "dex.json"), stableJson({ entries, lines: manifest.pokedex }));
    manifest.files.dex = "dex.json";
  }
  const spawnPaths = catalog.spawns.get(id) ?? [];
  if (spawnPaths.length > 0) {
    const pools: Record<string, unknown> = {};
    for (const path of spawnPaths) pools[path.slice(PREFIX.spawns.length)] = jar.readJson(path);
    await writeFile(join(dir, "spawn.json"), stableJson(pools));
    manifest.files.spawn = "spawn.json";
  }

  await writeFile(join(dir, "manifest.json"), stableJson(manifest));
}

function summarisePoser(jar: JarReader, path: string, out: string): { summary: PoserSummary; groups: Set<string>; refs: string[] } {
  const parsed = PoserFileSchema.safeParse(jar.readJson(path));
  if (!parsed.success) throw new SkipSpecies(`poser unreadable: ${path}: ${parsed.error.issues[0]?.message}`);
  const poser = parsed.data;
  const groups = new Set<string>();
  const refs = new Set<string>();
  const collect = (expr: string): string[] => {
    const found: string[] = [];
    for (const ref of findAnimationReferences(expr)) {
      groups.add(ref.group);
      for (const clip of ref.clips) {
        refs.add(`${ref.group}:${clip}`);
        found.push(`${ref.group}:${clip}`);
      }
    }
    return found;
  };
  const animations = poser.animations ?? {};
  for (const expr of Object.values(animations)) collect(expr);
  const poses: Record<string, Pose> = {};
  for (const [name, pose] of Object.entries(poser.poses ?? {})) {
    const clips = new Set<string>();
    const poseAnimations: PoseAnimation[] = [];
    for (const a of pose.animations ?? []) {
      if (typeof a === "string") poseAnimations.push(a);
      else if (a.animation !== undefined) poseAnimations.push({ animation: a.animation, condition: a.condition });
    }
    const expressions = [
      ...poseAnimations.map((a) => (typeof a === "string" ? a : a.animation)),
      ...(pose.quirks ?? []),
      ...Object.values(pose.namedAnimations ?? {}),
    ];
    for (const expr of expressions) {
      for (const clip of collect(expr)) clips.add(clip);
    }
    poses[name] = {
      poseTypes: pose.poseTypes ?? [],
      animations: poseAnimations,
      quirks: pose.quirks ?? [],
      namedAnimations: pose.namedAnimations,
      condition: pose.condition,
      isBattle: pose.isBattle,
      isTouchingWater: pose.isTouchingWater,
      isUnderWater: pose.isUnderWater,
      transformTicks: pose.transformTicks,
      clips: [...clips].sort(),
    };
  }
  return {
    summary: {
      file: out,
      synthesized: false,
      rootBone: poser.rootBone,
      portraitScale: poser.portraitScale,
      portraitTranslation: poser.portraitTranslation,
      profileScale: poser.profileScale,
      profileTranslation: poser.profileTranslation,
      animations,
      poses,
      unresolvedClips: [],
    },
    groups,
    refs: [...refs],
  };
}

/** The animation group a code poser would use: its own name, else the species, else the first group. */
function pickGroup(poserId: string, species: string, groups: string[]): string {
  const squash = (s: string): string => s.replace(/[_-]/g, "");
  return (
    groups.find((g) => g === poserId) ??
    groups.find((g) => squash(g) === squash(poserId)) ??
    groups.find((g) => g === species) ??
    [...groups].sort()[0]
  );
}

function synthesizePoser(group: string, clipNames: string[]): { summary: PoserSummary; refs: string[] } {
  const clips = new Set(clipNames);
  const refs: string[] = [];
  const animations: Record<string, string> = {};
  for (const name of CONVENTIONAL_ANIMATIONS) {
    if (!clips.has(name)) continue;
    animations[name] = `q.bedrock_stateful('${group}', '${name}')`;
    refs.push(`${group}:${name}`);
  }
  const quirks = clips.has("blink") ? [`q.bedrock_quirk('${group}', 'blink')`] : [];
  if (clips.has("blink")) refs.push(`${group}:blink`);
  const poses: Record<string, Pose> = {};
  for (const pose of CONVENTIONAL_POSES) {
    const clip = clips.has(pose.clip) ? pose.clip : pose.fallback && clips.has(pose.fallback) ? pose.fallback : null;
    if (!clip || poses[pose.name] !== undefined) continue;
    const ref = `${group}:${clip}`;
    refs.push(ref);
    poses[pose.name] = {
      poseTypes: pose.poseTypes,
      animations: [`q.bedrock('${group}', '${clip}')`],
      quirks,
      isBattle: pose.isBattle,
      clips: [ref],
    };
  }
  return {
    summary: { synthesized: true, animations, poses, unresolvedClips: [] },
    refs: [...new Set(refs)],
  };
}

function summariseClips(jar: JarReader, path: string): Record<string, Clip> {
  const parsed = AnimationFileSchema.safeParse(jar.readJson(path));
  if (!parsed.success) throw new SkipSpecies(`animation file unreadable: ${path}: ${parsed.error.issues[0]?.message}`);
  const clips: Record<string, Clip> = {};
  for (const [fullName, anim] of Object.entries(parsed.data.animations)) {
    // `animation.eevee.ground_idle` → `ground_idle`; keep odd names whole.
    const name = fullName.startsWith("animation.") ? fullName.split(".").slice(2).join(".") || fullName : fullName;
    let molang = 0;
    walkStrings(anim.bones ?? {}, (text, keyPath) => {
      if (keyPath.at(-1) === "lerp_mode") return;
      if (isMolangExpression(text)) molang++;
    });
    const soundEffects = Object.values(anim.sound_effects ?? {})
      .map((effect) => (effect && typeof effect === "object" && "effect" in effect ? String((effect as { effect: unknown }).effect) : null))
      .filter((effect): effect is string => effect !== null);
    clips[name] = {
      length: anim.animation_length,
      loop: anim.loop,
      bones: Object.keys(anim.bones ?? {}).length,
      molang,
      soundEffects: soundEffects.length > 0 ? soundEffects : undefined,
    };
  }
  return clips;
}

async function copy(jar: JarReader, jarPath: string, dir: string, out: string): Promise<void> {
  const target = join(dir, out);
  await mkdir(join(target, ".."), { recursive: true });
  await writeFile(target, jar.read(jarPath));
}

function basename(path: string): string {
  return path.slice(path.lastIndexOf("/") + 1);
}

interface IndexInput {
  jar: JarReader;
  catalog: Catalog;
  outDir: string;
  extracted: string[];
  skipped: Record<string, string>;
}

/** Rebuilds index.json from every species folder on disk, so partial runs stay consistent. */
async function writeIndex({ jar, catalog, outDir, extracted, skipped }: IndexInput): Promise<Index> {
  const previous = await readIndex(outDir);
  const species: Record<string, IndexEntry> = {};
  for (const entry of (await readdir(outDir, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
    if (!entry.isDirectory()) continue;
    const dir = join(outDir, entry.name);
    let manifest: Manifest;
    try {
      manifest = JSON.parse(await readFile(join(dir, "manifest.json"), "utf8")) as Manifest;
    } catch {
      continue;
    }
    const folder = await hashFolder(dir);
    species[entry.name] = { dex: manifest.dex, name: manifest.name, hash: folder.hash, files: folder.files, bytes: folder.bytes };
  }
  const mergedSkipped: Record<string, string> = { ...(previous?.skipped ?? {}), ...skipped };
  for (const id of extracted) delete mergedSkipped[id];
  for (const id of Object.keys(mergedSkipped)) if (species[id]) delete mergedSkipped[id];
  const index: Index = {
    format: 1,
    cobblemonVersion: catalog.cobblemonVersion,
    jarSha256: await sha256File(jar.path),
    species,
    skipped: mergedSkipped,
  };
  await writeFile(join(outDir, "index.json"), stableJson(index));
  return index;
}

export async function readIndex(outDir: string): Promise<Index | null> {
  try {
    const parsed = IndexSchema.safeParse(JSON.parse(await readFile(join(outDir, "index.json"), "utf8")));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}
