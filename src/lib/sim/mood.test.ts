import { describe, expect, it } from "vitest";
import { MOOD_BANDS, MOOD_LOW_THRESHOLD, MOOD_TEMPERAMENT_BIAS, MOOD_WEIGHTS, NEED_MAX, NIGHT_START_HOUR, SLEEPY_ENERGY } from "./constants";
import { freshState, neutralSpecies } from "./defaults";
import { isNight, mood, moodScore } from "./mood";
import { expectPure } from "./testing";

const NOON = "2026-11-01T12:00:00.000Z";
const NIGHT = `2026-11-01T${String(NIGHT_START_HOUR).padStart(2, "0")}:30:00.000Z`;
const species = neutralSpecies();

describe("mood", () => {
  it("does not mutate its inputs", () => {
    expectPure({ state: freshState(NOON, { hunger: 5 }), species }, (i) => mood(i.state, i.species, NOON));
  });

  it("is a weighted mean of the needs", () => {
    const state = freshState(NOON, { hunger: 40, fun: 60 });
    const expected = NEED_MAX - MOOD_WEIGHTS.hunger * 60 - MOOD_WEIGHTS.fun * 40;
    expect(moodScore(state, species)).toBeCloseTo(expected, 6);
  });

  it("reads the top band when every need is full", () => {
    expect(mood(freshState(NOON), species, NOON).label).toBe(MOOD_BANDS[0].label);
  });

  it("is asleep or sick before anything else", () => {
    const asleep = { ...freshState(NOON, { hunger: 0 }), asleep: true, sleepStartedAt: NOON };
    expect(mood(asleep, species, NOON).label).toBe("asleep");
    const sick = { ...freshState(NOON, { hunger: 0 }), sickness: { kind: "cold", since: NOON, severity: 1 as const } };
    expect(mood(sick, species, NOON).label).toBe("sick");
  });

  it("names the lowest need when it is under the low threshold", () => {
    const low = MOOD_LOW_THRESHOLD - 1;
    expect(mood(freshState(NOON, { hunger: low }), species, NOON)).toMatchObject({ label: "hungry", lowestNeed: "hunger" });
    expect(mood(freshState(NOON, { fun: low, energy: low - 1 }), species, NOON)).toMatchObject({ label: "tired", lowestNeed: "energy" });
    expect(mood(freshState(NOON, { hygiene: low }), species, NOON).label).toBe("grubby");
    expect(mood(freshState(NOON, { affection: low }), species, NOON).label).toBe("lonely");
  });

  it("is sleepy at night with low energy, in the trainer's local time", () => {
    const state = freshState(NOON, { energy: SLEEPY_ENERGY - 1 });
    expect(mood(state, species, NIGHT).label).toBe("sleepy");
    expect(mood(state, species, NOON).label).not.toBe("sleepy");
    expect(isNight(NOON, 10 * 60)).toBe(true);
    expect(isNight(NIGHT, 0)).toBe(true);
  });

  it("shifts the score by temperament", () => {
    const state = freshState(NOON, { hunger: 60 });
    const grumpy = { ...species, temperament: "grumpy" as const };
    expect(moodScore(state, grumpy)).toBeCloseTo(moodScore(state, species) + MOOD_TEMPERAMENT_BIAS.grumpy, 6);
  });
});
