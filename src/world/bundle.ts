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
 * The app calls `loadSpeciesBundle`; it never reaches into the cache layout
 * itself.
 */

import type { SpeciesBehaviour } from "@gotcha/cpkmn";
import type { PokemonBundle } from "./api";
import type { BedrockAnimationFile, BedrockGeometryFile, PoserFile } from "./bedrock/types";

/**
 * A poser entry either points at the mod's JSON poser or, for species whose
 * poser is Kotlin code in the mod, carries one the extractor synthesized
 * inline (`synthesized: true`, no `file`).
 */
type ManifestPoser = PoserFile & { file?: string; synthesized?: boolean };

interface Manifest {
  models: Record<string, string>;
  animations: Record<string, { file: string }>;
  posers: Record<string, ManifestPoser>;
  sounds?: Record<string, { file: string }>;
  files?: { resolvers?: string[]; species?: string };
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

export async function loadSpeciesBundle(species: string, aspects: string[] = []): Promise<PokemonBundle> {
  const index = await loadAssetIndex();
  const entry = index.species[species];
  if (!entry) throw new Error(`no assets for species ${species}`);
  const url = (file: string) => assetUrl(species, file, entry.v);

  const manifest = await getJson<Manifest>(url("manifest.json"));
  const resolverFiles = manifest.files?.resolvers ?? [];
  const resolvers = await Promise.all(resolverFiles.map((f) => getJson<Resolver>(url(f))));
  const picked = resolveVariation(resolvers, aspects);

  const modelFile = manifest.models[picked.model] ?? Object.values(manifest.models)[0];
  const poserEntry = manifest.posers[picked.poser] ?? Object.values(manifest.posers)[0];
  const animEntry = manifest.animations[picked.poser] ?? Object.values(manifest.animations)[0];
  if (!modelFile || !poserEntry || !animEntry) throw new Error(`cache for ${species} is missing model, poser or animations`);

  const speciesFile = manifest.files?.species;
  const [geometry, animations, poserJson, speciesJson] = await Promise.all([
    getJson<BedrockGeometryFile>(url(modelFile)),
    getJson<BedrockAnimationFile>(url(animEntry.file)),
    poserEntry.file ? getJson<PoserFile>(url(poserEntry.file)) : Promise.resolve(poserFromEntry(poserEntry)),
    speciesFile ? getJson<{ behaviour?: SpeciesBehaviour; baseScale?: number }>(url(speciesFile)) : Promise.resolve(null),
  ]);

  const cryFile = manifest.sounds?.cry?.file;
  return {
    species,
    geometry,
    animations,
    poser: poserJson,
    textures: {
      base: url(`textures/${picked.texture || `${species}.png`}`),
      emissive: picked.emissive ? url(`textures/${picked.emissive}`) : undefined,
    },
    sounds: cryFile ? { cry: url(cryFile) } : undefined,
    behaviour: speciesJson?.behaviour,
    baseScale: speciesJson?.baseScale ?? 1,
  };
}
