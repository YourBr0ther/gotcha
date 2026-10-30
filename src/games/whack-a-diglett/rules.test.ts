import { describe, expect, it } from "vitest";
import { canPop, DUGTRIO_AFTER_MS, DUGTRIO_CHANCE, gapAt, HOLES, isDugtrio, LAST_POP_BEFORE_END_MS, nextHole, popWindowAt, ROUND_MS, scoreRound } from "./rules";

describe("whack-a-diglett rules", () => {
  it("scores hits over pops and only an all-hit round is perfect", () => {
    expect(scoreRound({ hits: 0, pops: 0, dugtrioHits: 0 })).toEqual({ score: 0, maxScore: 1, perfect: false });
    expect(scoreRound({ hits: 20, pops: 20, dugtrioHits: 0 })).toEqual({ score: 20, maxScore: 20, perfect: true });
    expect(scoreRound({ hits: 15, pops: 20, dugtrioHits: 0 })).toEqual({ score: 15, maxScore: 20, perfect: false });
  });

  it("lets a Dugtrio hit cover one miss but never pays past every pop", () => {
    expect(scoreRound({ hits: 19, pops: 20, dugtrioHits: 1 })).toEqual({ score: 20, maxScore: 20, perfect: false });
    expect(scoreRound({ hits: 20, pops: 20, dugtrioHits: 3 })).toEqual({ score: 20, maxScore: 20, perfect: true });
  });

  it("shrinks the pop window and the gap across the round and clamps past it", () => {
    expect(popWindowAt(0)).toBeGreaterThan(popWindowAt(ROUND_MS));
    expect(popWindowAt(ROUND_MS + 5_000)).toBe(popWindowAt(ROUND_MS));
    expect(gapAt(0)).toBeGreaterThan(gapAt(ROUND_MS));
    expect(gapAt(-1)).toBe(gapAt(0));
  });

  it("never picks the same hole twice in a row and covers every hole", () => {
    const seen = new Set<number>();
    for (let i = 0; i < HOLES; i++) {
      const r = (i + 0.5) / HOLES;
      seen.add(nextHole(null, r));
      expect(nextHole(4, r)).not.toBe(4);
    }
    expect(seen.size).toBe(HOLES);
    expect(nextHole(0, 0)).toBe(1);
    expect(nextHole(HOLES - 1, 0.999999)).toBe(HOLES - 2);
  });

  it("holds Dugtrio back until the round has warmed up", () => {
    expect(isDugtrio(DUGTRIO_AFTER_MS - 1, 0)).toBe(false);
    expect(isDugtrio(DUGTRIO_AFTER_MS, DUGTRIO_CHANCE - 0.001)).toBe(true);
    expect(isDugtrio(DUGTRIO_AFTER_MS, DUGTRIO_CHANCE)).toBe(false);
  });

  it("stops popping just before the whistle", () => {
    expect(canPop(ROUND_MS - LAST_POP_BEFORE_END_MS - 1)).toBe(true);
    expect(canPop(ROUND_MS - LAST_POP_BEFORE_END_MS)).toBe(false);
  });
});
