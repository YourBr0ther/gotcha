/**
 * Builds a PokemonBundle from the extracted Cobblemon cache through the dev
 * route at /world/cache. A stand-in for the real asset service.
 */

import type { SpeciesBehaviour } from "@gotcha/cpkmn";
import type { PokemonBundle } from "../api";
import type { BedrockAnimationFile, BedrockGeometryFile, PoserFile } from "../bedrock/types";

interface Manifest {
  models: Record<string, string>;
  animations: Record<string, { file: string }>;
  posers: Record<string, { file: string }>;
  files?: { resolvers?: string[]; species?: string };
}

interface ResolverVariation {
  aspects: string[];
  model?: string;
  poser?: string;
  texture?: string;
}

interface Resolver {
  variations: ResolverVariation[];
}

const base = (species: string) => `/world/cache/${species}`;

async function getJson<T>(url: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${res.status} fetching ${url}`);
  return (await res.json()) as T;
}

async function exists(url: string): Promise<boolean> {
  const res = await fetch(url, { method: "HEAD" }).catch(() => null);
  return !!res && res.ok;
}

/** `cobblemon:eevee_male.geo` -> `eevee_male`; a texture path -> its basename. */
function key(id: string): string {
  const name = id.slice(id.lastIndexOf("/") + 1).replace(/^cobblemon:/, "");
  return name.replace(/\.geo$/, "");
}

export async function loadCacheBundle(species: string, aspects: string[]): Promise<PokemonBundle> {
  const root = base(species);
  const manifest = await getJson<Manifest>(`${root}/manifest.json`);
  const resolverFiles = manifest.files?.resolvers ?? [];
  const resolvers = await Promise.all(resolverFiles.map((f) => getJson<Resolver>(`${root}/${f}`)));

  // Walk the variations in order; later ones that match the aspects override.
  let model = "";
  let poser = "";
  let texture = "";
  for (const r of resolvers) {
    for (const v of r.variations) {
      if (!v.aspects.every((a) => aspects.includes(a))) continue;
      if (v.model) model = key(v.model);
      if (v.poser) poser = key(v.poser);
      if (v.texture) texture = key(v.texture);
    }
  }
  const modelFile = manifest.models[model] ?? Object.values(manifest.models)[0];
  const poserEntry = manifest.posers[poser] ?? Object.values(manifest.posers)[0];
  const animEntry = manifest.animations[poser] ?? Object.values(manifest.animations)[0];
  if (!modelFile || !poserEntry || !animEntry) throw new Error(`cache for ${species} is missing model, poser or animations`);

  const [geometry, animations, poserJson] = await Promise.all([
    getJson<BedrockGeometryFile>(`${root}/${modelFile}`),
    getJson<BedrockAnimationFile>(`${root}/${animEntry.file}`),
    getJson<PoserFile>(`${root}/${poserEntry.file}`),
  ]);

  let behaviour: SpeciesBehaviour | undefined;
  let baseScale = 1;
  if (manifest.files?.species) {
    const s = await getJson<{ behaviour?: SpeciesBehaviour; baseScale?: number }>(`${root}/${manifest.files.species}`);
    behaviour = s.behaviour;
    baseScale = s.baseScale ?? 1;
  }

  const cryUrl = `${root}/sounds/cry.ogg`;
  return {
    species,
    geometry,
    animations,
    poser: poserJson,
    textures: { base: `${root}/textures/${texture || `${species}.png`}` },
    sounds: (await exists(cryUrl)) ? { cry: cryUrl } : undefined,
    behaviour,
    baseScale,
  };
}
