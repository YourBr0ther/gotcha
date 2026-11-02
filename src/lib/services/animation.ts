/**
 * Which species move well enough to be offered: a starter in the picker,
 * a visitor wandering through a diorama. A pokemon that stands frozen or
 * slides across the grass with its legs still is worse than none, so a
 * species needs an idle that moves and a walk of its own.
 *
 * Two readings. The render audit (scripts/species-render-audit.py) loaded
 * every species in a browser and measured the bones; its verdicts are in
 * src/lib/data/animation-audit.json for the pack version it ran on and win
 * when the cache is that version. For any other version, or a species the
 * audit never saw, the poser is read the way the renderer reads it and the
 * clips it lands on are checked for motion. The two agree on most species
 * but not all (a walk layer that names legs the model lacks reads fine and
 * moves nothing), which is why the measurement comes first.
 */

import { readFile } from "node:fs/promises";
import path from "node:path";
import { readPoser, resolveActivity, type Activity, type PoseStack } from "@/world/bedrock/poser";
import type { PoserFile } from "@/world/bedrock/types";
import audit from "@/lib/data/animation-audit.json";
import { cacheDir, listSpecies } from "./species";

export interface AnimationVerdict {
  /** The standing pose moves at least one bone over time. */
  idle: boolean;
  /** Getting around has a clip or a leg or wing layer of its own; without one the pokemon slides in its idle pose. */
  walk: boolean;
  source: "audit" | "poser";
}

interface ManifestClip {
  bones?: number;
  length?: number;
  molang?: number;
}

interface Manifest {
  cobblemonVersion?: string;
  posers?: Record<string, PoserFile & { file?: string; synthesized?: boolean }>;
  animations?: Record<string, { clips?: Record<string, ManifestClip> }>;
}

/** A clip that moves at least one bone over time; a one-frame pose and a blink do not count. */
export function clipMoves(clip: ManifestClip | undefined): boolean {
  return !!clip && (clip.bones ?? 0) > 0 && ((clip.molang ?? 0) > 0 || (clip.length ?? 0) >= 0.3);
}

/** The static reading: the renderer's own pose resolution over the manifest's clip shapes. */
export function verdictFromPoser(poser: PoserFile, animations: Manifest["animations"]): Omit<AnimationVerdict, "source"> {
  const shapes = new Map<string, ManifestClip>();
  for (const [group, file] of Object.entries(animations ?? {})) {
    for (const [name, clip] of Object.entries(file.clips ?? {})) shapes.set(`animation.${group}.${name}`, clip);
  }
  const map = readPoser(poser, shapes.keys());
  // A flier rests in its hover and a fish in its float, and the renderer picks those by locomotion; try them in that order.
  const first = (activities: Activity[]) => activities.map((a) => resolveActivity(map, a)).find((s) => s !== undefined);
  const idle = first(["idle", "float", "hover"]);
  const walk = first(["walk", "swim", "fly"]);
  const moving = (stack: PoseStack | undefined, except: readonly string[] = []) => (stack?.clips ?? []).some((c) => !except.includes(c) && clipMoves(shapes.get(c)));
  return {
    idle: moving(idle),
    walk: moving(walk, idle?.clips ?? []) || (walk?.procedural ?? []).some((p) => p.kind !== "look"),
  };
}

const verdicts = new Map<string, Promise<AnimationVerdict>>();
const auditIdleStill = new Set(audit.idleStill);
const auditWalkMissing = new Set(audit.walkMissing);
const audited = new Set(audit.audited);

async function read(species: string): Promise<AnimationVerdict> {
  const dir = path.join(cacheDir(), species);
  const manifest = JSON.parse(await readFile(path.join(dir, "manifest.json"), "utf8")) as Manifest;
  if (manifest.cobblemonVersion === audit.cobblemonVersion && audited.has(species)) {
    return { idle: !auditIdleStill.has(species), walk: !auditWalkMissing.has(species), source: "audit" };
  }
  const entry = Object.values(manifest.posers ?? {})[0];
  if (!entry) return { idle: false, walk: false, source: "poser" };
  const poser = entry.file ? (JSON.parse(await readFile(path.join(dir, entry.file), "utf8")) as PoserFile) : entry;
  return { ...verdictFromPoser(poser, manifest.animations), source: "poser" };
}

export async function speciesAnimation(species: string): Promise<AnimationVerdict> {
  let pending = verdicts.get(species);
  if (!pending) {
    pending = read(species).catch((error) => {
      verdicts.delete(species);
      throw error;
    });
    verdicts.set(species, pending);
  }
  return pending;
}

export function animatesEnough(v: Pick<AnimationVerdict, "idle" | "walk">): boolean {
  return v.idle && v.walk;
}

let pickable: Promise<Set<string>> | null = null;

/** Every extracted species that animates enough to be offered. Built once per process. */
export function pickableSpecies(): Promise<Set<string>> {
  pickable ??= (async () => {
    const ids = await listSpecies();
    const out = new Set<string>();
    await Promise.all(
      ids.map(async (id) => {
        const v = await speciesAnimation(id).catch(() => null);
        if (v && animatesEnough(v)) out.add(id);
      }),
    );
    return out;
  })().catch((error) => {
    pickable = null;
    throw error;
  });
  return pickable;
}

/** Forget what was read, for tests and a cache rebuild. */
export function resetAnimationVerdicts(): void {
  verdicts.clear();
  pickable = null;
}
