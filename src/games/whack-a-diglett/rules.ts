/**
 * Whack-a-Diglett pacing and scoring. Pure. One Diglett at a time pops
 * from one of nine holes for a window that shrinks across the round; a
 * Dugtrio shows up now and then and a hit on it counts double, which can
 * cover an earlier miss.
 */

export const ROUND_MS = 45_000;
export const HOLES = 9;
/** No pop starts this close to the end, so the last one can still be hit. */
export const LAST_POP_BEFORE_END_MS = 900;
/** How long a hit Diglett stays visible with its hit face before the hole empties. */
export const HIT_LINGER_MS = 160;
export const DUGTRIO_AFTER_MS = 12_000;
export const DUGTRIO_CHANCE = 0.14;
/** A Dugtrio hit counts for this many hits. */
export const DUGTRIO_WEIGHT = 2;

const POP_WINDOW_START_MS = 1_300;
const POP_WINDOW_END_MS = 560;
const GAP_START_MS = 650;
const GAP_END_MS = 260;

function ramp(start: number, end: number, elapsedMs: number): number {
  const t = Math.max(0, Math.min(1, elapsedMs / ROUND_MS));
  return start + (end - start) * t;
}

/** How long a Diglett stays up, shrinking across the round. */
export function popWindowAt(elapsedMs: number): number {
  return ramp(POP_WINDOW_START_MS, POP_WINDOW_END_MS, elapsedMs);
}

/** Quiet time between pops, shrinking across the round. */
export function gapAt(elapsedMs: number): number {
  return ramp(GAP_START_MS, GAP_END_MS, elapsedMs);
}

/** Picks a hole that is not the one just used. */
export function nextHole(previous: number | null, random: number): number {
  const r = Math.max(0, Math.min(0.999999, random));
  if (previous === null) return Math.floor(r * HOLES);
  const pick = Math.floor(r * (HOLES - 1));
  return pick >= previous ? pick + 1 : pick;
}

export function isDugtrio(elapsedMs: number, random: number): boolean {
  return elapsedMs >= DUGTRIO_AFTER_MS && random < DUGTRIO_CHANCE;
}

export function canPop(elapsedMs: number): boolean {
  return elapsedMs < ROUND_MS - LAST_POP_BEFORE_END_MS;
}

export interface WhackTally {
  hits: number;
  pops: number;
  /** Hits that were on a Dugtrio; already counted in hits. */
  dugtrioHits: number;
}

/** score is hits over pops with Dugtrio hits weighted, capped at every pop; perfect means every pop was hit. */
export function scoreRound({ hits, pops, dugtrioHits }: WhackTally): { score: number; maxScore: number; perfect: boolean } {
  if (pops <= 0) return { score: 0, maxScore: 1, perfect: false };
  const weighted = Math.min(pops, hits + dugtrioHits * (DUGTRIO_WEIGHT - 1));
  return { score: weighted, maxScore: pops, perfect: hits === pops };
}
