/**
 * Berry Catch scoring and pacing. Pure: positions are fractions of the play
 * area so the component can be any size.
 */

export const ROUND_MS = 60_000;
export const MAX_MISSES = 3;
/** Basket and berry widths as fractions of the play width. */
export const BASKET_WIDTH = 0.24;
export const BERRY_WIDTH = 0.1;
/** Berries resolve (caught or missed) when their centre reaches this height. */
export const CATCH_Y = 0.86;
/** Spawning stops this long before the end so every berry lands in time. */
export const LAST_SPAWN_BEFORE_END_MS = 2_500;
/** How fast the basket slides toward the finger, in play widths per second. */
export const BASKET_SPEED = 3.2;

const SPAWN_INTERVAL_START_MS = 1_150;
const SPAWN_INTERVAL_END_MS = 520;
const FALL_START_MS = 2_700;
const FALL_END_MS = 1_450;

function ramp(start: number, end: number, elapsedMs: number): number {
  const t = Math.max(0, Math.min(1, elapsedMs / ROUND_MS));
  return start + (end - start) * t;
}

/** Milliseconds until the next berry, shrinking across the round. */
export function spawnIntervalAt(elapsedMs: number): number {
  return ramp(SPAWN_INTERVAL_START_MS, SPAWN_INTERVAL_END_MS, elapsedMs);
}

/** Milliseconds a berry takes to fall the full height, shrinking across the round. */
export function fallDurationAt(elapsedMs: number): number {
  return ramp(FALL_START_MS, FALL_END_MS, elapsedMs);
}

/** True when a berry centred at berryX lands in a basket centred at basketX. */
export function isCaught(berryX: number, basketX: number): boolean {
  return Math.abs(berryX - basketX) <= BASKET_WIDTH / 2 + BERRY_WIDTH / 4 + 1e-9;
}

/** A spawn x that keeps the whole berry on screen. */
export function spawnX(random: number): number {
  const margin = BERRY_WIDTH / 2;
  return margin + Math.max(0, Math.min(1, random)) * (1 - 2 * margin);
}

export function canSpawn(elapsedMs: number): boolean {
  return elapsedMs < ROUND_MS - LAST_SPAWN_BEFORE_END_MS;
}

export function isOver(missed: number, elapsedMs: number, inFlight: number): boolean {
  if (missed >= MAX_MISSES) return true;
  return elapsedMs >= ROUND_MS && inFlight === 0;
}

export interface BerryTally {
  caught: number;
  missed: number;
}

/** score is caught over everything that landed; perfect means nothing was dropped. */
export function scoreRound({ caught, missed }: BerryTally): { score: number; maxScore: number; perfect: boolean } {
  const landed = caught + missed;
  if (landed <= 0) return { score: 0, maxScore: 1, perfect: false };
  return { score: caught, maxScore: landed, perfect: missed === 0 };
}
