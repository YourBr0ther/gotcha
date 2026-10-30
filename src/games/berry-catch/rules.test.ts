import { describe, expect, it } from "vitest";
import { BASKET_WIDTH, BERRY_WIDTH, canSpawn, fallDurationAt, isCaught, isOver, LAST_SPAWN_BEFORE_END_MS, MAX_MISSES, ROUND_MS, scoreRound, spawnIntervalAt, spawnX } from "./rules";

describe("berry catch rules", () => {
  it("scores caught over landed and calls a clean round perfect", () => {
    expect(scoreRound({ caught: 0, missed: 0 })).toEqual({ score: 0, maxScore: 1, perfect: false });
    expect(scoreRound({ caught: 12, missed: 0 })).toEqual({ score: 12, maxScore: 12, perfect: true });
    expect(scoreRound({ caught: 9, missed: 3 })).toEqual({ score: 9, maxScore: 12, perfect: false });
    expect(scoreRound({ caught: 0, missed: 3 })).toEqual({ score: 0, maxScore: 3, perfect: false });
  });

  it("ends on the third miss or when the clock runs out with nothing in the air", () => {
    expect(isOver(MAX_MISSES - 1, 0, 0)).toBe(false);
    expect(isOver(MAX_MISSES, 0, 4)).toBe(true);
    expect(isOver(0, ROUND_MS, 1)).toBe(false);
    expect(isOver(0, ROUND_MS, 0)).toBe(true);
  });

  it("catches at the basket edge and not past it", () => {
    const edge = BASKET_WIDTH / 2 + BERRY_WIDTH / 4;
    expect(isCaught(0.5 + edge, 0.5)).toBe(true);
    expect(isCaught(0.5 + edge + 0.001, 0.5)).toBe(false);
    expect(isCaught(0.5 - edge, 0.5)).toBe(true);
  });

  it("speeds up across the round and never past its end", () => {
    expect(spawnIntervalAt(0)).toBeGreaterThan(spawnIntervalAt(ROUND_MS / 2));
    expect(spawnIntervalAt(ROUND_MS / 2)).toBeGreaterThan(spawnIntervalAt(ROUND_MS));
    expect(spawnIntervalAt(ROUND_MS * 2)).toBe(spawnIntervalAt(ROUND_MS));
    expect(fallDurationAt(0)).toBeGreaterThan(fallDurationAt(ROUND_MS));
    expect(fallDurationAt(-100)).toBe(fallDurationAt(0));
  });

  it("stops spawning so the last berry lands before the whistle", () => {
    expect(canSpawn(ROUND_MS - LAST_SPAWN_BEFORE_END_MS - 1)).toBe(true);
    expect(canSpawn(ROUND_MS - LAST_SPAWN_BEFORE_END_MS)).toBe(false);
  });

  it("keeps spawns fully inside the play width", () => {
    expect(spawnX(0)).toBeCloseTo(BERRY_WIDTH / 2);
    expect(spawnX(1)).toBeCloseTo(1 - BERRY_WIDTH / 2);
    expect(spawnX(2)).toBeCloseTo(1 - BERRY_WIDTH / 2);
  });
});
