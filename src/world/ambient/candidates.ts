/**
 * Which wild pokemon may visit a diorama. The server lists species that
 * prefer the scene and are small; `pickCast` keeps a handful of them as the
 * scene's regulars for the day, so the same six or so faces come and go
 * rather than a different stranger every minute, and a new day brings a
 * new cast. One of them visits at a time; see Ambient.tsx for the schedule.
 */

import { mulberry32 } from "../dioramas/build";

export interface AmbientCandidate {
  species: string;
  baseScale: number;
  flies: boolean;
  swims: boolean;
  walks: boolean;
}

/** How a visitor gets around the scene: fliers orbit, walkers and swimmers wander their grid. */
export type AmbientRole = "flier" | "walker" | "swimmer";

export interface AmbientPick {
  species: string;
  role: AmbientRole;
}

/** How many regulars a scene keeps for a day. */
export const CAST_SIZE = 6;
/** Of those, at most this many fliers, so the ground is not empty while the sky is busy. */
const CAST_FLIERS = 2;

function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

export function roleOf(c: AmbientCandidate): AmbientRole {
  if (c.flies) return "flier";
  if (!c.walks && c.swims) return "swimmer";
  return "walker";
}

/** Fisher-Yates with the given source of randomness; returns a new array. */
export function shuffle<T>(list: readonly T[], rand: () => number): T[] {
  const out = list.slice();
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/** `YYYY-MM-DD` in the viewer's local time, the part of the cast seed that rotates it daily. */
export function dayKey(now = new Date()): string {
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  return `${now.getFullYear()}-${m}-${d}`;
}

/**
 * The scene's regulars: a seeded draw of up to `size` species, at most two
 * fliers, the rest walkers and swimmers. The active pokemon's species never
 * appears, and a species that can only swim is left out of a scene with no
 * water. Same seed, same cast.
 */
export function pickCast(candidates: AmbientCandidate[], seed: string, exclude: string[] = [], hasWater = true, size = CAST_SIZE): AmbientPick[] {
  const rand = mulberry32(hash(seed));
  const pool = shuffle(
    candidates.filter((c) => !exclude.includes(c.species) && (hasWater || c.walks || c.flies)),
    rand,
  );
  const fliers = pool.filter((c) => c.flies).slice(0, CAST_FLIERS);
  const grounded = pool.filter((c) => !c.flies).slice(0, Math.max(0, size - fliers.length));
  const cast = [...fliers, ...grounded];
  // A scene short on ground species fills up with more fliers rather than staying thin.
  if (cast.length < size) {
    for (const c of pool) {
      if (cast.length >= size) break;
      if (!cast.includes(c)) cast.push(c);
    }
  }
  return shuffle(cast, rand).map((c) => ({ species: c.species, role: roleOf(c) }));
}

export async function fetchAmbientCandidates(diorama: string): Promise<AmbientCandidate[]> {
  const res = await fetch(`/api/assets/ambient?diorama=${encodeURIComponent(diorama)}`);
  if (!res.ok) throw new Error(`${res.status} fetching ambient candidates for ${diorama}`);
  const body = (await res.json()) as { candidates: AmbientCandidate[] };
  return body.candidates;
}
