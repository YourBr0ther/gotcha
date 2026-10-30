/**
 * Which wild pokemon dress a diorama. The server lists species that prefer
 * the scene and are small; this picks up to two of them, one for the air
 * and one for the ground or water, the same two every time for a scene so
 * the world feels settled rather than reshuffled on each visit.
 */

import { mulberry32 } from "../dioramas/build";

export interface AmbientCandidate {
  species: string;
  baseScale: number;
  flies: boolean;
  swims: boolean;
  walks: boolean;
}

export type AmbientRole = "flier" | "walker";

export interface AmbientPick {
  species: string;
  role: AmbientRole;
}

function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

export function pickAmbient(candidates: AmbientCandidate[], seed: string, exclude: string[] = [], max = 2): AmbientPick[] {
  const rand = mulberry32(hash(seed));
  const pool = candidates.filter((c) => !exclude.includes(c.species));
  const choose = (list: AmbientCandidate[]) => (list.length ? list[Math.floor(rand() * list.length)] : undefined);
  const picks: AmbientPick[] = [];
  const flier = choose(pool.filter((c) => c.flies));
  if (flier) picks.push({ species: flier.species, role: "flier" });
  const grounded = choose(pool.filter((c) => !c.flies && c.species !== flier?.species));
  if (grounded) picks.push({ species: grounded.species, role: "walker" });
  if (picks.length < max) {
    const rest = choose(pool.filter((c) => !picks.some((p) => p.species === c.species)));
    if (rest) picks.push({ species: rest.species, role: rest.flies ? "flier" : "walker" });
  }
  return picks.slice(0, max);
}

export async function fetchAmbientCandidates(diorama: string): Promise<AmbientCandidate[]> {
  const res = await fetch(`/api/assets/ambient?diorama=${encodeURIComponent(diorama)}`);
  if (!res.ok) throw new Error(`${res.status} fetching ambient candidates for ${diorama}`);
  const body = (await res.json()) as { candidates: AmbientCandidate[] };
  return body.candidates;
}
