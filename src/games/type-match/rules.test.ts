import { describe, expect, it } from "vitest";
import { dealCards, FREE_MISSES, FULL_TIME_SHARE, isOver, moveScore, PAIRS, SCORE_SCALE, scoreRound, TIME_LIMIT_MS, timeScore, TYPES } from "./rules";

function seeded(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}

describe("type match rules", () => {
  it("deals PAIRS distinct types twice each", () => {
    const cards = dealCards(seeded(7));
    expect(cards).toHaveLength(PAIRS * 2);
    const counts = new Map<string, number>();
    for (const c of cards) counts.set(c, (counts.get(c) ?? 0) + 1);
    expect(counts.size).toBe(PAIRS);
    for (const n of counts.values()) expect(n).toBe(2);
    for (const c of cards) expect(TYPES).toContain(c);
  });

  it("deals differently for different seeds and the same for the same seed", () => {
    expect(dealCards(seeded(1))).toEqual(dealCards(seeded(1)));
    expect(dealCards(seeded(1))).not.toEqual(dealCards(seeded(2)));
  });

  it("gives full move credit inside the free misses and then falls to zero over two passes", () => {
    expect(moveScore(PAIRS)).toBe(1);
    expect(moveScore(PAIRS + FREE_MISSES)).toBe(1);
    expect(moveScore(PAIRS + FREE_MISSES + 1)).toBeCloseTo(1 - 1 / (2 * PAIRS));
    expect(moveScore(PAIRS + FREE_MISSES + 2 * PAIRS)).toBe(0);
    expect(moveScore(PAIRS * 10)).toBe(0);
  });

  it("gives full time credit through the quick half and none at the limit", () => {
    const half = TIME_LIMIT_MS * FULL_TIME_SHARE;
    expect(timeScore(0)).toBe(1);
    expect(timeScore(half)).toBe(1);
    expect(timeScore(half + 1)).toBeLessThan(1);
    expect(timeScore((half + TIME_LIMIT_MS) / 2)).toBeCloseTo(0.5);
    expect(timeScore(TIME_LIMIT_MS)).toBe(0);
    expect(timeScore(TIME_LIMIT_MS * 2)).toBe(0);
  });

  it("calls a quick, tidy clear perfect and nothing else", () => {
    expect(scoreRound({ matched: PAIRS, moves: PAIRS + FREE_MISSES, elapsedMs: TIME_LIMIT_MS * FULL_TIME_SHARE })).toEqual({ score: SCORE_SCALE, maxScore: SCORE_SCALE, perfect: true });
    expect(scoreRound({ matched: PAIRS, moves: PAIRS + FREE_MISSES + 1, elapsedMs: 1000 }).perfect).toBe(false);
    expect(scoreRound({ matched: PAIRS, moves: PAIRS, elapsedMs: TIME_LIMIT_MS * FULL_TIME_SHARE + 1 }).perfect).toBe(false);
    expect(scoreRound({ matched: PAIRS - 1, moves: PAIRS, elapsedMs: 1000 }).perfect).toBe(false);
  });

  it("scales with pairs found and never leaves the 0..maxScore range", () => {
    expect(scoreRound({ matched: 0, moves: 0, elapsedMs: 0 })).toEqual({ score: 0, maxScore: SCORE_SCALE, perfect: false });
    const half = scoreRound({ matched: PAIRS / 2, moves: PAIRS / 2, elapsedMs: 1000 });
    expect(half.score).toBe(SCORE_SCALE / 2);
    const slow = scoreRound({ matched: PAIRS, moves: PAIRS * 5, elapsedMs: TIME_LIMIT_MS });
    expect(slow.score).toBe(0);
    const over = scoreRound({ matched: PAIRS + 3, moves: 0, elapsedMs: 0 });
    expect(over.score).toBe(SCORE_SCALE);
  });

  it("ends when every pair is found or the clock runs out", () => {
    expect(isOver(PAIRS - 1, TIME_LIMIT_MS - 1)).toBe(false);
    expect(isOver(PAIRS, 0)).toBe(true);
    expect(isOver(0, TIME_LIMIT_MS)).toBe(true);
  });
});
