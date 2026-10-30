/**
 * Whether a species can be loaded as ambient set dressing before anything
 * heavy is fetched. The bundle loader assumes the base variation (no
 * aspects) names a model, a poser and a PNG texture that the manifest
 * carries; some packs break that (an animated `{ fps, frames }` texture,
 * an animation group with no file, a resolver with no base variation) and
 * the loader then asks for `/api/assets/<species>/undefined` or throws
 * half way through. The picker probes the manifest and resolvers, which
 * are small, and skips the species instead.
 */

import { assetUrl, loadAssetIndex } from "../bundle";
import { pickAmbient, type AmbientCandidate, type AmbientPick } from "./candidates";

export interface AmbientManifest {
  models?: Record<string, unknown>;
  animations?: Record<string, { file?: unknown } | null | undefined>;
  posers?: Record<string, { file?: unknown; synthesized?: unknown } | null | undefined>;
  files?: { resolvers?: unknown };
}

export interface AmbientResolver {
  variations?: Array<{ aspects?: unknown; model?: unknown; poser?: unknown; texture?: unknown }>;
}

/** `cobblemon:eevee_male.geo` -> `eevee_male`; a texture path -> its basename. Mirrors the bundle loader. */
function key(id: string): string {
  return id.slice(id.lastIndexOf("/") + 1).replace(/^cobblemon:/, "").replace(/\.geo$/, "");
}

function firstValue<T>(record: Record<string, T> | undefined): T | undefined {
  return record ? Object.values(record)[0] : undefined;
}

/** Null when the species will load; otherwise why it would not. */
export function ambientLoadable(manifest: AmbientManifest, resolvers: AmbientResolver[]): string | null {
  if (resolvers.length === 0) return "no resolvers";
  let model = "";
  let poser = "";
  let texture: unknown = undefined;
  let base = false;
  for (const r of resolvers) {
    if (!Array.isArray(r.variations)) return "resolver without variations";
    for (const v of r.variations) {
      if (!Array.isArray(v.aspects) || v.aspects.length > 0) continue;
      base = true;
      if (typeof v.model === "string") model = key(v.model);
      if (typeof v.poser === "string") poser = key(v.poser);
      if (v.texture !== undefined) texture = v.texture;
    }
  }
  if (!base) return "no base variation";
  if (texture !== undefined && typeof texture !== "string") return "animated texture";
  if (typeof texture === "string" && !/\.png$/i.test(texture)) return "base texture is not a png";

  const modelFile = manifest.models?.[model] ?? firstValue(manifest.models);
  if (typeof modelFile !== "string" || modelFile.length === 0) return "no model file";
  const poserEntry = manifest.posers?.[poser] ?? firstValue(manifest.posers);
  if (!poserEntry) return "no poser";
  if (typeof poserEntry.file !== "string" && poserEntry.synthesized !== true) return "poser without a file";
  const animation = manifest.animations?.[poser] ?? firstValue(manifest.animations);
  if (!animation || typeof animation.file !== "string" || animation.file.length === 0) return "no animation file";
  return null;
}

async function getJson<T>(url: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${res.status} fetching ${url}`);
  return (await res.json()) as T;
}

/** Fetches the manifest and resolvers for one species and checks them. False when anything is off or missing. */
export async function probeAmbient(species: string): Promise<boolean> {
  try {
    const index = await loadAssetIndex();
    const entry = index.species[species];
    if (!entry) return false;
    const url = (file: string) => assetUrl(species, file, entry.v);
    const manifest = await getJson<AmbientManifest>(url("manifest.json"));
    const files = Array.isArray(manifest.files?.resolvers) ? manifest.files.resolvers.filter((f): f is string => typeof f === "string") : [];
    const resolvers = await Promise.all(files.map((f) => getJson<AmbientResolver>(url(f))));
    const reason = ambientLoadable(manifest, resolvers);
    if (reason) console.warn(`[world] skipping ambient ${species}: ${reason}`);
    return reason === null;
  } catch (err) {
    console.warn(`[world] skipping ambient ${species}: probe failed`, err);
    return false;
  }
}

export type AmbientProbe = (species: string) => Promise<boolean>;

/**
 * pickAmbient, with every pick probed first. A species that fails the
 * probe is excluded and the pick re-run, so the scene gets the next
 * candidate rather than an empty slot or a loader error.
 */
export async function pickLoadableAmbient(candidates: AmbientCandidate[], seed: string, exclude: string[], probe: AmbientProbe, max = 2): Promise<AmbientPick[]> {
  const skip = [...exclude];
  const verdicts = new Map<string, boolean>();
  for (let round = 0; round < candidates.length + 1; round++) {
    const picks = pickAmbient(candidates, seed, skip, max);
    const results = await Promise.all(
      picks.map(async (p) => {
        let ok = verdicts.get(p.species);
        if (ok === undefined) {
          ok = await probe(p.species);
          verdicts.set(p.species, ok);
        }
        return { pick: p, ok };
      }),
    );
    const failed = results.filter((r) => !r.ok).map((r) => r.pick.species);
    if (failed.length === 0) return picks;
    skip.push(...failed);
  }
  return [];
}
