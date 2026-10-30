/**
 * Loads everything the renderer needs for one species from the asset route:
 * geometry, clips, poser, texture URLs, cry URL, behaviour, scale.
 *
 * URL scheme: `/api/assets/<species>/<file>?v=<version>`, where the version
 * comes from `/api/assets/index` (the species hash from the cache's
 * index.json, shortened). The route answers immutable for a year when the
 * version matches, so a rebuilt cache changes every URL and nothing stale
 * survives in a browser.
 *
 * Load order, kept short because every await here costs a frame of the
 * scene that is starting up behind it:
 *
 *   index  ──┐
 *   manifest ┴─> model ∥ animations ∥ poser ∥ species ∥ textures
 *
 * The manifest goes out together with the index under the version this
 * browser saw last time (remembered in localStorage), so a repeat visit
 * hits the immutable cache for both; a first visit asks for it unversioned
 * and the route revalidates. The manifest carries the resolver variations
 * inline, so nothing else is needed before the files themselves. Textures
 * are prefetched here (see bedrock/prefetch.ts) and picked up by the
 * texture loader.
 *
 * The app calls `loadSpeciesBundle`; it never reaches into the cache layout
 * itself.
 */

import type { SpeciesBehaviour } from "@gotcha/cpkmn";
import type { PokemonBundle } from "./api";
import { prefetchImage } from "./bedrock/prefetch";
import type { BedrockAnimationFile, BedrockGeometryFile, PoserFile } from "./bedrock/types";
import { measure, now } from "./perf";

/**
 * A poser entry either points at the mod's JSON poser or, for species whose
 * poser is Kotlin code in the mod, carries one the extractor synthesized
 * inline (`synthesized: true`, no `file`).
 */
type ManifestPoser = PoserFile & { file?: string; synthesized?: boolean };

/** A variation as the manifest writes it: file paths relative to the species folder. */
export interface ManifestVariation {
  aspects: string[];
  model?: string;
  poser?: string;
  texture?: string;
  layers?: ResolverLayer[];
}

interface Manifest {
  models: Record<string, string>;
  animations: Record<string, { file: string }>;
  posers: Record<string, ManifestPoser>;
  sounds?: Record<string, { file: string }>;
  files?: { resolvers?: string[]; species?: string };
  /** The resolver variations, inlined by the extractor with file paths. */
  variations?: ManifestVariation[];
}

interface ResolverLayer {
  name?: string;
  texture?: string;
  emissive?: boolean;
}

interface ResolverVariation {
  aspects: string[];
  model?: string;
  poser?: string;
  texture?: string;
  layers?: ResolverLayer[];
}

interface Resolver {
  variations: ResolverVariation[];
}

interface AssetIndex {
  species: Record<string, { v: string; name: string; dex: number }>;
}

export const ASSET_BASE = "/api/assets";

async function getJson<T>(url: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${res.status} fetching ${url}`);
  return (await res.json()) as T;
}

let indexPromise: Promise<AssetIndex> | null = null;

/** The asset index, fetched once per page. A failed fetch is retried next call. */
export function loadAssetIndex(): Promise<AssetIndex> {
  if (!indexPromise) {
    indexPromise = getJson<AssetIndex>(`${ASSET_BASE}/index`).catch((err) => {
      indexPromise = null;
      throw err;
    });
  }
  return indexPromise;
}

/** Forget the cached index, for tests and for a cache rebuild notice. */
export function resetAssetIndex(): void {
  indexPromise = null;
  inflight.clear();
}

const VERSION_KEY = "gotcha.assetVersion.";

/** The version this browser last loaded a species under, so the manifest can go out before the index answers. */
export function rememberedVersion(species: string): string | undefined {
  try {
    return globalThis.localStorage?.getItem(VERSION_KEY + species) ?? undefined;
  } catch {
    return undefined;
  }
}

export function rememberVersion(species: string, version: string): void {
  try {
    globalThis.localStorage?.setItem(VERSION_KEY + species, version);
  } catch {
    // Private mode or a full store; the next visit just takes the longer path.
  }
}

/** `cobblemon:eevee_male.geo` -> `eevee_male`; a texture path -> its basename. */
function key(id: string): string {
  const name = id.slice(id.lastIndexOf("/") + 1).replace(/^cobblemon:/, "");
  return name.replace(/\.geo$/, "");
}

export interface ResolvedVariation {
  model: string;
  poser: string;
  texture: string;
  /** Basename of the first emissive layer whose aspects all match, if any. */
  emissive?: string;
}

/**
 * Walk the resolver variations in order; every variation whose aspects are
 * all present applies, later ones overriding earlier. Mirrors Cobblemon's
 * own resolver, so the same aspects pick the same files as the game.
 */
export function resolveVariation(resolvers: Resolver[], aspects: string[]): ResolvedVariation {
  const out: ResolvedVariation = { model: "", poser: "", texture: "" };
  for (const r of resolvers) {
    for (const v of r.variations) {
      if (!v.aspects.every((a) => aspects.includes(a))) continue;
      if (v.model) out.model = key(v.model);
      if (v.poser) out.poser = key(v.poser);
      if (v.texture) out.texture = key(v.texture);
      for (const layer of v.layers ?? []) {
        if (layer.emissive && layer.texture) out.emissive = key(layer.texture);
      }
    }
  }
  return out;
}

/** The picked files for a species, as paths relative to its folder. */
export interface PickedFiles {
  model: string;
  poser: ManifestPoser;
  animations: string;
  texture: string;
  emissive?: string;
}

/** `models/eevee_male.geo.json` -> `eevee_male`, the key the manifest maps use. */
function manifestKey(file: string): string {
  return file
    .slice(file.lastIndexOf("/") + 1)
    .replace(/\.geo\.json$/, "")
    .replace(/\.json$/, "");
}

/**
 * Pick the files for a set of aspects from the manifest's inline
 * variations, the same walk as `resolveVariation` but on file paths. Falls
 * back to the first entry of each map when no variation names one.
 */
export function pickFromManifest(manifest: Manifest, species: string, aspects: string[]): PickedFiles {
  const variations = (manifest.variations ?? []).map((v) => ({
    ...v,
    model: v.model === undefined ? undefined : manifestKey(v.model),
    poser: v.poser === undefined ? undefined : manifestKey(v.poser),
  }));
  const picked = resolveVariation([{ variations }], aspects);
  const modelFile = manifest.models[picked.model] ?? Object.values(manifest.models)[0];
  const poserEntry = manifest.posers[picked.poser] ?? Object.values(manifest.posers)[0];
  const animEntry = manifest.animations[picked.poser] ?? Object.values(manifest.animations)[0];
  if (!modelFile || !poserEntry || !animEntry) throw new Error(`cache for ${species} is missing model, poser or animations`);
  return {
    model: modelFile,
    poser: poserEntry,
    animations: animEntry.file,
    texture: `textures/${picked.texture || `${species}.png`}`,
    emissive: picked.emissive ? `textures/${picked.emissive}` : undefined,
  };
}

/** Build the versioned URL for one file of a species. */
export function assetUrl(species: string, file: string, version?: string): string {
  const base = `${ASSET_BASE}/${species}/${file}`;
  return version ? `${base}?v=${encodeURIComponent(version)}` : base;
}

/** The inline poser, without the manifest's own bookkeeping keys. */
export function poserFromEntry(entry: ManifestPoser): PoserFile {
  const { file: _file, synthesized: _synthesized, ...poser } = entry;
  void _file;
  void _synthesized;
  return poser;
}

const inflight = new Map<string, Promise<PokemonBundle>>();

export interface LoadOptions {
  /** Prefix for the performance measures; the ambient dressing uses `ambient` so its numbers stay apart from the active pokemon's. */
  label?: string;
}

/**
 * Load a species. Concurrent calls for the same species and aspects share
 * one load (React's StrictMode runs the loading effect twice in dev).
 */
export function loadSpeciesBundle(species: string, aspects: string[] = [], options: LoadOptions = {}): Promise<PokemonBundle> {
  const k = `${species}|${[...aspects].sort().join(",")}`;
  let p = inflight.get(k);
  if (!p) {
    p = loadBundle(species, aspects, options.label ?? "bundle").finally(() => inflight.delete(k));
    inflight.set(k, p);
  }
  return p;
}

async function loadBundle(species: string, aspects: string[], label: string): Promise<PokemonBundle> {
  const t0 = now();
  const remembered = rememberedVersion(species);
  const indexPromise = loadAssetIndex();
  // Out together with the index. Unversioned on a first visit (the route
  // revalidates), versioned from then on so the immutable cache answers.
  let manifestPromise = getJson<Manifest>(assetUrl(species, "manifest.json", remembered));
  manifestPromise.catch(() => undefined);

  const index = await indexPromise;
  measure(`${label}:index`, t0);
  const entry = index.species[species];
  if (!entry) throw new Error(`no assets for species ${species}`);
  const url = (file: string) => assetUrl(species, file, entry.v);
  if (remembered !== entry.v) {
    rememberVersion(species, entry.v);
    // The remembered version was stale: the cached manifest under it is too.
    if (remembered) manifestPromise = getJson<Manifest>(url("manifest.json"));
  }

  const t1 = now();
  const manifest = await manifestPromise;
  measure(`${label}:manifest`, t1);

  let picked: PickedFiles;
  if (manifest.variations) {
    picked = pickFromManifest(manifest, species, aspects);
  } else {
    // An older cache without inline variations: read the resolvers themselves.
    const resolvers = await Promise.all((manifest.files?.resolvers ?? []).map((f) => getJson<Resolver>(url(f))));
    const legacy = resolveVariation(resolvers, aspects);
    picked = pickFromManifest({ ...manifest, variations: [{ aspects: [], model: legacy.model, poser: legacy.poser, texture: legacy.texture, layers: legacy.emissive ? [{ emissive: true, texture: legacy.emissive }] : [] }] }, species, aspects);
  }

  const textures: PokemonBundle["textures"] = {
    base: url(picked.texture),
    emissive: picked.emissive ? url(picked.emissive) : undefined,
  };
  // Textures ride along with the JSON; a prefetch that fails is retried by the texture loader.
  prefetchImage(textures.base).catch(() => undefined);
  if (textures.emissive) prefetchImage(textures.emissive).catch(() => undefined);

  const speciesFile = manifest.files?.species;
  const t2 = now();
  const [geometry, animations, poserJson, speciesJson] = await Promise.all([
    getJson<BedrockGeometryFile>(url(picked.model)),
    getJson<BedrockAnimationFile>(url(picked.animations)),
    picked.poser.file ? getJson<PoserFile>(url(picked.poser.file)) : Promise.resolve(poserFromEntry(picked.poser)),
    speciesFile ? getJson<{ behaviour?: SpeciesBehaviour; baseScale?: number }>(url(speciesFile)) : Promise.resolve(null),
  ]);
  measure(`${label}:files`, t2);
  measure(label, t0);

  const cryFile = manifest.sounds?.cry?.file;
  return {
    species,
    geometry,
    animations,
    poser: poserJson,
    textures,
    sounds: cryFile ? { cry: url(cryFile) } : undefined,
    behaviour: speciesJson?.behaviour,
    baseScale: speciesJson?.baseScale ?? 1,
  };
}
