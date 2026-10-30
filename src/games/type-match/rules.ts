/**
 * Type Match dealing and scoring. Pure. A round deals PAIRS types out of
 * the eighteen; score weighs moves against the minimum, with a little
 * slack for the luck of the first flips, and the time left.
 */

export const TYPES = [
  "normal",
  "fire",
  "water",
  "grass",
  "electric",
  "ice",
  "fighting",
  "poison",
  "ground",
  "flying",
  "psychic",
  "bug",
  "rock",
  "ghost",
  "dragon",
  "dark",
  "steel",
  "fairy",
] as const;

export type TypeName = (typeof TYPES)[number];

export const PAIRS = 8;
export const TIME_LIMIT_MS = 90_000;
/** Moves past the minimum that still count as perfect; the first flips are blind. */
export const FREE_MISSES = 2;
/** How long a wrong pair stays face up. */
export const FLIP_BACK_MS = 700;
/** Finishing within this share of the limit earns the whole time score. */
export const FULL_TIME_SHARE = 0.5;
const MOVE_WEIGHT = 0.75;

/** Picks PAIRS distinct types and lays out two of each, shuffled. */
export function dealCards(random: () => number): TypeName[] {
  const pool = [...TYPES];
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  const cards = pool.slice(0, PAIRS).flatMap((t) => [t, t]);
  for (let i = cards.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [cards[i], cards[j]] = [cards[j], cards[i]];
  }
  return cards;
}

/** 1 within the free misses, then falling by a move's share of two full passes. */
export function moveScore(moves: number, pairs = PAIRS): number {
  const extra = moves - pairs - FREE_MISSES;
  if (extra <= 0) return 1;
  return Math.max(0, 1 - extra / (2 * pairs));
}

/** 1 inside the first half of the limit, then falling to 0 at the limit. */
export function timeScore(elapsedMs: number, limitMs = TIME_LIMIT_MS): number {
  const full = limitMs * FULL_TIME_SHARE;
  if (elapsedMs <= full) return 1;
  return Math.max(0, (limitMs - elapsedMs) / (limitMs - full));
}

export interface MatchTally {
  matched: number;
  moves: number;
  elapsedMs: number;
  pairs?: number;
  limitMs?: number;
}

export const SCORE_SCALE = 1000;

/** score is out of SCORE_SCALE; perfect means every pair found inside the free misses and the quick half. */
export function scoreRound({ matched, moves, elapsedMs, pairs = PAIRS, limitMs = TIME_LIMIT_MS }: MatchTally): { score: number; maxScore: number; perfect: boolean } {
  const completion = Math.max(0, Math.min(1, matched / pairs));
  const m = moveScore(moves, pairs);
  const t = timeScore(elapsedMs, limitMs);
  const raw = completion * (MOVE_WEIGHT * m + (1 - MOVE_WEIGHT) * t);
  return { score: Math.round(raw * SCORE_SCALE), maxScore: SCORE_SCALE, perfect: matched === pairs && m === 1 && t === 1 };
}

export function isOver(matched: number, elapsedMs: number, pairs = PAIRS, limitMs = TIME_LIMIT_MS): boolean {
  return matched >= pairs || elapsedMs >= limitMs;
}
