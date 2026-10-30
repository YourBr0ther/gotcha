import { describe, expect, it } from "vitest";
import {
  AUTO_SLEEP_ENERGY,
  DAY,
  DECAY_MULTIPLIER_MAX,
  DECAY_MULTIPLIER_MIN,
  DECAY_PER_HOUR,
  ENERGY_RECOVERY_PER_HOUR,
  HEALTH_DRAIN_PER_HOUR,
  HEALTH_RECOVERY_PER_HOUR,
  HOUR,
  LOW_THRESHOLD,
  MESS_HYGIENE_DROP,
  MESS_INTERVAL,
  MINUTE,
  NEED_MAX,
  SICKNESS_ONSET_HEALTH,
  SICKNESS_REST_CLEAR,
  SICKNESS_SEVERITY_HEALTH,
  SLEEP_DECAY_MULTIPLIER,
} from "./constants";
import { decay, ratesAt } from "./decay";
import { freshState, neutralPersonality, neutralSpecies } from "./defaults";
import { expectPure } from "./testing";
import { toIso } from "./util";

const T0 = "2026-11-01T08:00:00.000Z";
const t0 = Date.parse(T0);
const after = (ms: number) => toIso(t0 + ms);
const personality = neutralPersonality();
const species = neutralSpecies();

describe("decay", () => {
  it("does not mutate its inputs", () => {
    const state = freshState(T0, { energy: 10, hunger: 15 });
    expectPure({ state, personality, species }, (i) => decay(i.state, i.personality, i.species, after(2 * DAY)));
  });

  it("returns an unchanged copy when no time has passed", () => {
    const state = freshState(T0);
    const { state: out, events } = decay(state, personality, species, T0);
    expect(out).toEqual(state);
    expect(out).not.toBe(state);
    expect(events).toEqual([]);
    expect(decay(state, personality, species, after(-HOUR)).state.lastTickAt).toBe(T0);
  });

  it("drains each need at its base rate while awake", () => {
    const { state } = decay(freshState(T0), personality, species, after(HOUR));
    for (const need of ["hunger", "energy", "hygiene", "fun", "affection"] as const) {
      expect(state.needs[need]).toBeCloseTo(NEED_MAX - DECAY_PER_HOUR[need], 6);
    }
    expect(state.needs.health).toBe(NEED_MAX);
    expect(state.lastTickAt).toBe(after(HOUR));
    expect(state.ageDays).toBeCloseTo(HOUR / DAY, 9);
  });

  it("takes (100 - 20) / rate hours for hunger to reach the low threshold", () => {
    const ms = HOUR * ((NEED_MAX - LOW_THRESHOLD.hunger) / DECAY_PER_HOUR.hunger);
    const { state, events } = decay(freshState(T0), personality, species, after(ms + MINUTE));
    expect(state.needs.hunger).toBeCloseTo(LOW_THRESHOLD.hunger - DECAY_PER_HOUR.hunger / 60, 4);
    // ISO timestamps carry whole milliseconds, so the crossing is reported truncated.
    expect(events.find((e) => e.kind === "need_low" && e.need === "hunger")?.at).toBe(after(Math.floor(ms)));
  });

  it("applies personality multipliers, clamped to the allowed range", () => {
    const fast = { ...personality, decayMultipliers: { ...personality.decayMultipliers, hunger: 3, fun: 0.01 } };
    const { state } = decay(freshState(T0), fast, species, after(HOUR));
    expect(state.needs.hunger).toBeCloseTo(NEED_MAX - DECAY_PER_HOUR.hunger * DECAY_MULTIPLIER_MAX, 6);
    expect(state.needs.fun).toBeCloseTo(NEED_MAX - DECAY_PER_HOUR.fun * DECAY_MULTIPLIER_MIN, 6);
  });

  it("applies species modifiers on top of personality", () => {
    const greedy = { ...species, decayModifiers: { hunger: 1.2 } };
    const picky = { ...personality, decayMultipliers: { ...personality.decayMultipliers, hunger: 1.25 } };
    const { state } = decay(freshState(T0), picky, greedy, after(HOUR));
    expect(state.needs.hunger).toBeCloseTo(NEED_MAX - DECAY_PER_HOUR.hunger * 1.2 * 1.25, 6);
  });

  it("slows hunger and hygiene and recovers energy while asleep", () => {
    const state = { ...freshState(T0, { energy: 10 }), asleep: true, sleepStartedAt: T0 };
    const { state: out } = decay(state, personality, species, after(HOUR));
    expect(out.needs.hunger).toBeCloseTo(NEED_MAX - DECAY_PER_HOUR.hunger * SLEEP_DECAY_MULTIPLIER.hunger, 6);
    expect(out.needs.hygiene).toBeCloseTo(NEED_MAX - DECAY_PER_HOUR.hygiene * SLEEP_DECAY_MULTIPLIER.hygiene, 6);
    expect(out.needs.energy).toBeCloseTo(10 + ENERGY_RECOVERY_PER_HOUR, 6);
    expect(out.asleep).toBe(true);
  });

  it("wakes on its own at full energy and decays at the awake rate from then on", () => {
    const start = 40;
    const sleepMs = HOUR * ((NEED_MAX - start) / ENERGY_RECOVERY_PER_HOUR);
    const state = { ...freshState(T0, { energy: start }), asleep: true, sleepStartedAt: T0 };
    const { state: out, events } = decay(state, personality, species, after(sleepMs + HOUR));
    expect(out.asleep).toBe(false);
    expect(out.sleepStartedAt).toBeNull();
    expect(events.find((e) => e.kind === "woke_up")?.at).toBe(after(sleepMs));
    expect(out.needs.energy).toBeCloseTo(NEED_MAX - DECAY_PER_HOUR.energy, 6);
    const sleepHours = sleepMs / HOUR;
    expect(out.needs.hunger).toBeCloseTo(NEED_MAX - DECAY_PER_HOUR.hunger * (SLEEP_DECAY_MULTIPLIER.hunger * sleepHours + 1), 6);
  });

  it("falls asleep where it stands when energy runs out", () => {
    const start = 10;
    const awakeMs = HOUR * ((start - AUTO_SLEEP_ENERGY) / DECAY_PER_HOUR.energy);
    const { state, events } = decay(freshState(T0, { energy: start }), personality, species, after(awakeMs + HOUR));
    expect(state.asleep).toBe(true);
    expect(state.sleepStartedAt).toBe(after(awakeMs));
    expect(events.find((e) => e.kind === "fell_asleep")?.at).toBe(after(awakeMs));
    expect(state.needs.energy).toBeCloseTo(ENERGY_RECOVERY_PER_HOUR, 6);
  });

  it("makes a mess on the mess clock while awake, not while asleep", () => {
    const { state, events } = decay(freshState(T0), personality, species, after(MESS_INTERVAL + HOUR));
    expect(events.filter((e) => e.kind === "mess")).toHaveLength(1);
    expect(state.lastMessAt).toBe(after(MESS_INTERVAL));
    expect(state.needs.hygiene).toBeCloseTo(NEED_MAX - DECAY_PER_HOUR.hygiene * (MESS_INTERVAL / HOUR + 1) - MESS_HYGIENE_DROP, 6);

    const asleep = { ...freshState(T0, { energy: 0 }), asleep: true, sleepStartedAt: T0 };
    const sleepMs = HOUR * (NEED_MAX / ENERGY_RECOVERY_PER_HOUR);
    const napped = decay(asleep, personality, species, after(Math.min(sleepMs, MESS_INTERVAL) - MINUTE));
    expect(napped.events.filter((e) => e.kind === "mess")).toHaveLength(0);
  });

  it("starts the mess clock at lastTickAt when the file never set it", () => {
    const state = { ...freshState(T0), lastMessAt: null };
    const { state: out, events } = decay(state, personality, species, after(HOUR));
    expect(out.lastMessAt).toBe(T0);
    expect(events.filter((e) => e.kind === "mess")).toHaveLength(0);
  });

  it("drains health while hunger is under its threshold and recovers it otherwise", () => {
    const hungry = freshState(T0, { hunger: LOW_THRESHOLD.hunger - 1, health: 80 });
    expect(decay(hungry, personality, species, after(HOUR)).state.needs.health).toBeCloseTo(80 - HEALTH_DRAIN_PER_HOUR.hunger, 6);

    const fine = freshState(T0, { health: 50 });
    expect(decay(fine, personality, species, after(HOUR)).state.needs.health).toBeCloseTo(50 + HEALTH_RECOVERY_PER_HOUR.awake, 6);
    const resting = { ...freshState(T0, { health: 50, energy: 0 }), asleep: true, sleepStartedAt: T0 };
    expect(decay(resting, personality, species, after(HOUR)).state.needs.health).toBeCloseTo(50 + HEALTH_RECOVERY_PER_HOUR.asleep, 6);
  });

  it("gets sick when health falls to the onset threshold and worsens as it keeps falling", () => {
    const drain = HEALTH_DRAIN_PER_HOUR.hunger;
    const state = freshState(T0, { hunger: 0, health: SICKNESS_ONSET_HEALTH + drain });
    const { state: sick, events } = decay(state, personality, species, after(2 * HOUR));
    expect(sick.sickness).toEqual({ kind: "stomach_ache", since: after(HOUR), severity: 1 });
    expect(events.find((e) => e.kind === "sickness_started")?.at).toBe(after(HOUR));
    expect(sick.needs.health).toBeCloseTo(SICKNESS_ONSET_HEALTH - (drain + HEALTH_DRAIN_PER_HOUR.sickness), 6);

    const longer = decay(state, personality, species, after(DAY));
    expect(longer.state.sickness?.severity).toBe(3);
    expect(longer.events.filter((e) => e.kind === "sickness_worsened").map((e) => e.detail)).toEqual(["2", "3"]);
    expect(longer.state.needs.health).toBe(0);
  });

  it("names the sickness after the cause", () => {
    const dirty = freshState(T0, { hygiene: 0, health: SICKNESS_ONSET_HEALTH + 1 });
    expect(decay(dirty, personality, species, after(HOUR)).state.sickness?.kind).toBe("cold");
  });

  it("clears sickness after a long rest when hunger and hygiene are fine, then wakes", () => {
    const state = {
      ...freshState(T0, { energy: 0, health: SICKNESS_SEVERITY_HEALTH[0] + 1 }),
      asleep: true,
      sleepStartedAt: T0,
      sickness: { kind: "cold", since: T0, severity: 1 as const },
    };
    // Rest clears the sickness; the pokemon then sleeps on until energy is full, if it is not already.
    const fullAt = HOUR * (NEED_MAX / ENERGY_RECOVERY_PER_HOUR);
    const wakeAt = Math.max(SICKNESS_REST_CLEAR, fullAt);
    const { state: out, events } = decay(state, personality, species, after(wakeAt + MINUTE));
    expect(out.sickness).toBeNull();
    expect(events.find((e) => e.kind === "sickness_cleared")?.at).toBe(after(SICKNESS_REST_CLEAR));
    expect(out.asleep).toBe(false);
    expect(events.find((e) => e.kind === "woke_up")?.at).toBe(after(Math.floor(wakeAt)));
  });

  it("does not clear sickness by rest while starving", () => {
    const state = {
      ...freshState(T0, { energy: 0, hunger: 0 }),
      asleep: true,
      sleepStartedAt: T0,
      sickness: { kind: "stomach_ache", since: T0, severity: 1 as const },
    };
    const { state: out } = decay(state, personality, species, after(SICKNESS_REST_CLEAR + HOUR));
    expect(out.sickness?.kind).toBe("stomach_ache");
  });

  it("applies an active modifier only until it expires", () => {
    const factor = 0.7;
    const mods = [{ need: "fun" as const, factor, until: after(2 * HOUR) }];
    const { state } = decay(freshState(T0), personality, species, after(4 * HOUR), mods);
    expect(state.needs.fun).toBeCloseTo(NEED_MAX - DECAY_PER_HOUR.fun * (factor * 2 + 2), 6);
  });

  it("gives the same answer whether called once or every minute", () => {
    const whole = decay(freshState(T0, { energy: 30 }), personality, species, after(12 * HOUR)).state;
    let step = freshState(T0, { energy: 30 });
    for (let m = 1; m <= 12 * 60; m++) step = decay(step, personality, species, after(m * MINUTE)).state;
    for (const need of Object.keys(whole.needs) as (keyof typeof whole.needs)[]) {
      expect(step.needs[need]).toBeCloseTo(whole.needs[need], 6);
    }
    expect(step.asleep).toBe(whole.asleep);
    expect(step.lastMessAt).toBe(whole.lastMessAt);
  });

  it("reports the current rates without changing state", () => {
    const state = freshState(T0);
    expectPure(state, (s) => ratesAt(s, personality, species, [], T0));
    expect(ratesAt(state, personality, species, [], T0).hunger).toBe(-DECAY_PER_HOUR.hunger);
  });
});
