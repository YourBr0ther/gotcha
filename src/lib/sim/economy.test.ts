import { describe, expect, it } from "vitest";
import { NEED_NAMES } from "@gotcha/cpkmn";
import {
  MILESTONE_BYTES,
  MINIGAME_BASE_BYTES,
  MINIGAME_BASE_EXPERIENCE,
  MINIGAME_DAILY_CAP,
  MINIGAME_FLOOR,
  MINIGAME_HALF_LIFE_GAMES,
  STIPEND_FULL_CARE_BONUS,
  STIPEND_MAX,
  STIPEND_THRESHOLD,
} from "./constants";
import { fullNeeds } from "./defaults";
import { dailyStipend, milestoneBonus, miniGameMultiplier, miniGamePayout } from "./economy";
import { expectPure } from "./testing";

const good = fullNeeds();
const bad = { ...fullNeeds(), hunger: STIPEND_THRESHOLD - 1 };
const result = { game: "berry_catch", score: 1, durationMs: 60_000, completed: true };

describe("dailyStipend", () => {
  it("does not mutate its input", () => {
    expectPure([good, bad], (h) => dailyStipend(h));
  });

  it("pays nothing without samples and the full amount plus bonus for a perfect day", () => {
    expect(dailyStipend([])).toBe(0);
    expect(dailyStipend([good, good, good])).toBe(STIPEND_MAX + STIPEND_FULL_CARE_BONUS);
  });

  it("pays for the share of need-samples above the threshold, no bonus", () => {
    const expected = Math.round(STIPEND_MAX * ((NEED_NAMES.length - 0.5) / NEED_NAMES.length));
    expect(dailyStipend([good, bad])).toBe(expected);
    const empty = Object.fromEntries(NEED_NAMES.map((n) => [n, 0])) as typeof good;
    expect(dailyStipend([empty, empty])).toBe(0);
  });
});

describe("miniGamePayout", () => {
  it("does not mutate its inputs", () => {
    expectPure({ result, totals: { gamesPlayed: 2, bytesEarned: 10 } }, (i) => miniGamePayout(i.result, i.totals));
  });

  it("pays the base for the first perfect game of the day", () => {
    expect(miniGamePayout(result, { gamesPlayed: 0, bytesEarned: 0 })).toEqual({ bytes: MINIGAME_BASE_BYTES, experience: MINIGAME_BASE_EXPERIENCE });
  });

  it("diminishes with each game played and never under the floor", () => {
    expect(miniGameMultiplier(0)).toBe(1);
    expect(miniGameMultiplier(MINIGAME_HALF_LIFE_GAMES)).toBeCloseTo(0.5, 9);
    expect(miniGameMultiplier(1_000)).toBe(MINIGAME_FLOOR);
    let last = Infinity;
    for (let games = 0; games < 20; games++) {
      const { bytes } = miniGamePayout(result, { gamesPlayed: games, bytesEarned: 0 });
      expect(bytes).toBeLessThanOrEqual(last);
      last = bytes;
    }
    expect(miniGamePayout(result, { gamesPlayed: MINIGAME_HALF_LIFE_GAMES, bytesEarned: 0 }).bytes).toBe(Math.round(MINIGAME_BASE_BYTES / 2));
  });

  it("stops at the daily cap", () => {
    expect(miniGamePayout(result, { gamesPlayed: 0, bytesEarned: MINIGAME_DAILY_CAP - 3 }).bytes).toBe(3);
    expect(miniGamePayout(result, { gamesPlayed: 0, bytesEarned: MINIGAME_DAILY_CAP }).bytes).toBe(0);
  });

  it("scales by score, halves unfinished games and clamps bad scores", () => {
    expect(miniGamePayout({ ...result, score: 0.5 }, { gamesPlayed: 0, bytesEarned: 0 }).bytes).toBe(Math.round(MINIGAME_BASE_BYTES / 2));
    expect(miniGamePayout({ ...result, completed: false }, { gamesPlayed: 0, bytesEarned: 0 }).bytes).toBe(Math.round(MINIGAME_BASE_BYTES / 2));
    expect(miniGamePayout({ ...result, score: 7 }, { gamesPlayed: 0, bytesEarned: 0 }).bytes).toBe(MINIGAME_BASE_BYTES);
    expect(miniGamePayout({ ...result, score: NaN }, { gamesPlayed: 0, bytesEarned: 0 }).bytes).toBe(0);
  });

  it("cannot grind more than the cap in a day", () => {
    let earned = 0;
    for (let games = 0; games < 100; games++) earned += miniGamePayout(result, { gamesPlayed: games, bytesEarned: earned }).bytes;
    expect(earned).toBe(MINIGAME_DAILY_CAP);
  });
});

describe("milestoneBonus", () => {
  it("reads the constants", () => {
    for (const kind of Object.keys(MILESTONE_BYTES) as (keyof typeof MILESTONE_BYTES)[]) {
      expect(milestoneBonus(kind)).toBe(MILESTONE_BYTES[kind]);
    }
  });
});
