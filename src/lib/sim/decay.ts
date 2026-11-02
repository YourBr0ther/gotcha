/**
 * Lazy decay. State is stored as of lastTickAt and moved forward to `now`
 * on read. There is no tick loop: the interval is walked in segments whose
 * boundaries are the moments something discrete happens (the pokemon falls
 * asleep or wakes, a need crosses its low threshold, hunger reaches the
 * forage line, a mess, sickness starting or worsening, rest clearing
 * sickness, a toy wearing off). Rates
 * are constant inside a segment so each boundary is found in closed form.
 */

import type { IsoDate, NeedName, Needs, Personality, State } from "@gotcha/cpkmn";
import {
  AUTO_SLEEP_ENERGY,
  AUTO_WAKE_ENERGY,
  DAY,
  DECAY_PER_HOUR,
  ENERGY_RECOVERY_PER_HOUR,
  FORAGE,
  HEALTH_DRAIN_PER_HOUR,
  HEALTH_RECOVERY_PER_HOUR,
  HOUR,
  LOW_THRESHOLD,
  MESS_HYGIENE_DROP,
  MESS_INTERVAL,
  NEED_MAX,
  SICKNESS_ONSET_HEALTH,
  SICKNESS_REST_CLEAR,
  SICKNESS_SEVERITY_HEALTH,
  SLEEP_DECAY_MULTIPLIER,
} from "./constants";
import type { ActiveModifier, EngineEvent, SpeciesFacts } from "./types";
import { clampMultipliers, clampNeed, cloneState, hoursOf, parseIso, toIso } from "./util";

export interface DecayResult {
  state: State;
  events: EngineEvent[];
}

const DRAINING_NEEDS: readonly Exclude<NeedName, "energy" | "health">[] = ["hunger", "hygiene", "fun", "affection"];
const LOW_NEEDS: readonly (keyof typeof LOW_THRESHOLD)[] = ["hunger", "hygiene"];
const MAX_SEGMENTS = 100_000;

interface ParsedModifier {
  need: NeedName;
  factor: number;
  untilMs: number;
}

type Boundary =
  | { kind: "end" }
  | { kind: "modifier" }
  | { kind: "wake" }
  | { kind: "sleep" }
  | { kind: "low"; need: keyof typeof LOW_THRESHOLD }
  | { kind: "forage" }
  | { kind: "mess" }
  | { kind: "sick" }
  | { kind: "worsen"; severity: 2 | 3 }
  | { kind: "rest_clear" };

/** Signed change per hour for every need given the pokemon's current mode. */
export function ratesAt(
  state: State,
  personality: Personality,
  species: SpeciesFacts,
  modifiers: readonly ActiveModifier[],
  now: IsoDate,
): Needs {
  return rates(state, clampMultipliers(personality.decayMultipliers), clampMultipliers(species.decayModifiers), parseModifiers(modifiers), parseIso(now));
}

function parseModifiers(modifiers: readonly ActiveModifier[]): ParsedModifier[] {
  return modifiers.map((m) => ({ need: m.need, factor: m.factor, untilMs: parseIso(m.until) }));
}

function modifierFactor(mods: readonly ParsedModifier[], need: NeedName, tMs: number): number {
  let factor = 1;
  for (const m of mods) if (m.need === need && m.untilMs > tMs) factor *= m.factor;
  return factor;
}

function healthDrain(state: State): number {
  let drain = 0;
  if (state.needs.hunger < LOW_THRESHOLD.hunger) drain += HEALTH_DRAIN_PER_HOUR.hunger;
  if (state.needs.hygiene < LOW_THRESHOLD.hygiene) drain += HEALTH_DRAIN_PER_HOUR.hygiene;
  if (state.sickness) drain += HEALTH_DRAIN_PER_HOUR.sickness * state.sickness.severity;
  return drain;
}

function rates(state: State, pMult: Needs, sMult: Needs, mods: readonly ParsedModifier[], tMs: number): Needs {
  const out = {} as Needs;
  for (const need of DRAINING_NEEDS) {
    let rate = DECAY_PER_HOUR[need] * pMult[need] * sMult[need] * modifierFactor(mods, need, tMs);
    if (state.asleep) rate *= SLEEP_DECAY_MULTIPLIER[need];
    out[need] = -rate;
  }
  out.energy = state.asleep
    ? ENERGY_RECOVERY_PER_HOUR
    : -(DECAY_PER_HOUR.energy * pMult.energy * sMult.energy * modifierFactor(mods, "energy", tMs));
  const drain = healthDrain(state);
  out.health = drain > 0 ? -(drain * pMult.health * sMult.health) : state.asleep ? HEALTH_RECOVERY_PER_HOUR.asleep : HEALTH_RECOVERY_PER_HOUR.awake;
  return out;
}

/** Milliseconds until `value` moving at `ratePerHour` reaches `target`, or Infinity. */
function timeTo(value: number, target: number, ratePerHour: number): number {
  if (ratePerHour === 0) return Infinity;
  const dt = ((target - value) / ratePerHour) * HOUR;
  return dt > 0 ? dt : Infinity;
}

function sicknessKind(state: State): string {
  if (state.needs.hunger < LOW_THRESHOLD.hunger) return "stomach_ache";
  if (state.needs.hygiene < LOW_THRESHOLD.hygiene) return "cold";
  return "fever";
}

/**
 * Move `state` from its lastTickAt to `now`. Returns a new state and the
 * events that happened on the way. A `now` at or before lastTickAt returns
 * an unchanged copy.
 */
export function decay(
  state: State,
  personality: Personality,
  species: SpeciesFacts,
  now: IsoDate,
  modifiers: readonly ActiveModifier[] = [],
): DecayResult {
  const startMs = parseIso(state.lastTickAt);
  const endMs = parseIso(now);
  const s = cloneState(state);
  const events: EngineEvent[] = [];
  if (endMs <= startMs) return { state: s, events };

  const pMult = clampMultipliers(personality.decayMultipliers);
  const sMult = clampMultipliers(species.decayModifiers);
  const mods = parseModifiers(modifiers);
  // The mess clock starts on the first decay if the file never set it.
  if (s.lastMessAt == null) s.lastMessAt = state.lastTickAt;

  let t = startMs;
  for (let step = 0; t < endMs; step++) {
    if (step >= MAX_SEGMENTS) throw new Error("decay: too many segments");

    // Things that are already due at t happen before any time passes.
    if (!s.asleep && s.needs.energy <= AUTO_SLEEP_ENERGY) {
      fallAsleep(s, t, events, "exhausted");
      continue;
    }
    if (s.asleep && s.needs.energy >= AUTO_WAKE_ENERGY && !sleepingItOff(s)) {
      wakeUp(s, t, events, "rested");
      continue;
    }
    if (!s.asleep && parseIso(s.lastMessAt!) + MESS_INTERVAL <= t) {
      mess(s, t, events);
      continue;
    }
    // Awake and already past the forage line (woke up hungry, or the file predates foraging): eat first.
    if (!s.asleep && s.needs.hunger < FORAGE.startHunger) {
      forage(s, t, events);
      continue;
    }
    if (s.sickness && restCanClear(s) && parseIso(s.sleepStartedAt!) + SICKNESS_REST_CLEAR <= t) {
      clearSickness(s, t, events, "rest");
      continue;
    }

    const r = rates(s, pMult, sMult, mods, t);
    const pending: { next: number; boundary: Boundary } = { next: endMs, boundary: { kind: "end" } };
    const consider = (dtMs: number, b: Boundary) => {
      if (dtMs > 0 && t + dtMs < pending.next) {
        pending.next = t + dtMs;
        pending.boundary = b;
      }
    };

    for (const m of mods) if (m.untilMs > t) consider(m.untilMs - t, { kind: "modifier" });
    if (s.asleep && !sleepingItOff(s)) consider(timeTo(s.needs.energy, AUTO_WAKE_ENERGY, r.energy), { kind: "wake" });
    else if (!s.asleep) consider(timeTo(s.needs.energy, AUTO_SLEEP_ENERGY, r.energy), { kind: "sleep" });
    for (const need of LOW_NEEDS) {
      if (s.needs[need] >= LOW_THRESHOLD[need]) consider(timeTo(s.needs[need], LOW_THRESHOLD[need], r[need]), { kind: "low", need });
    }
    if (!s.asleep) consider(timeTo(s.needs.hunger, FORAGE.startHunger, r.hunger), { kind: "forage" });
    if (!s.asleep) consider(parseIso(s.lastMessAt!) + MESS_INTERVAL - t, { kind: "mess" });
    if (r.health < 0) {
      if (!s.sickness) {
        consider(timeTo(s.needs.health, SICKNESS_ONSET_HEALTH, r.health), { kind: "sick" });
      } else {
        for (let i = 0; i < SICKNESS_SEVERITY_HEALTH.length; i++) {
          const severity = (i + 2) as 2 | 3;
          if (s.sickness.severity < severity) consider(timeTo(s.needs.health, SICKNESS_SEVERITY_HEALTH[i], r.health), { kind: "worsen", severity });
        }
      }
    }
    if (s.sickness && restCanClear(s)) consider(parseIso(s.sleepStartedAt!) + SICKNESS_REST_CLEAR - t, { kind: "rest_clear" });

    const { next, boundary } = pending;
    const hours = hoursOf(next - t);
    for (const need of Object.keys(r) as NeedName[]) s.needs[need] = clampNeed(s.needs[need] + r[need] * hours);
    t = next;

    // Snap to the boundary value so floating point cannot land just shy of it.
    switch (boundary.kind) {
      case "end":
      case "modifier":
        break;
      case "wake":
        s.needs.energy = AUTO_WAKE_ENERGY;
        break;
      case "sleep":
        s.needs.energy = AUTO_SLEEP_ENERGY;
        break;
      case "low":
        s.needs[boundary.need] = LOW_THRESHOLD[boundary.need];
        // Strictly under the threshold from here on; nudge below so the loop does not re-arm it.
        s.needs[boundary.need] = Math.max(0, s.needs[boundary.need] - Number.EPSILON * NEED_MAX);
        events.push({ kind: "need_low", at: toIso(t), need: boundary.need });
        break;
      case "forage":
        s.needs.hunger = FORAGE.startHunger;
        forage(s, t, events);
        break;
      case "mess":
        mess(s, t, events);
        break;
      case "sick":
        s.needs.health = SICKNESS_ONSET_HEALTH;
        s.sickness = { kind: sicknessKind(s), since: toIso(t), severity: 1 };
        events.push({ kind: "sickness_started", at: toIso(t), detail: s.sickness.kind });
        break;
      case "worsen":
        s.needs.health = SICKNESS_SEVERITY_HEALTH[boundary.severity - 2];
        s.sickness = { ...s.sickness!, severity: boundary.severity };
        events.push({ kind: "sickness_worsened", at: toIso(t), detail: String(boundary.severity) });
        break;
      case "rest_clear":
        clearSickness(s, t, events, "rest");
        break;
    }
  }

  s.lastTickAt = now;
  s.ageDays = state.ageDays + (endMs - startMs) / DAY;
  return { state: s, events };
}

/** Sick, asleep, and the rest will clear it: sleeps through full energy. */
function sleepingItOff(s: State): boolean {
  return s.sickness != null && restCanClear(s);
}

function restCanClear(s: State): boolean {
  return s.asleep && s.sleepStartedAt != null && s.needs.hunger >= LOW_THRESHOLD.hunger && s.needs.hygiene >= LOW_THRESHOLD.hygiene;
}

function fallAsleep(s: State, tMs: number, events: EngineEvent[], detail: string): void {
  s.asleep = true;
  s.sleepStartedAt = toIso(tMs);
  events.push({ kind: "fell_asleep", at: toIso(tMs), detail });
}

function wakeUp(s: State, tMs: number, events: EngineEvent[], detail: string): void {
  s.asleep = false;
  s.sleepStartedAt = null;
  events.push({ kind: "woke_up", at: toIso(tMs), detail });
}

/** Finds some wild food: hunger up to the forage ceiling, a little dirt from the rooting around. */
function forage(s: State, tMs: number, events: EngineEvent[]): void {
  s.needs.hunger = Math.max(s.needs.hunger, FORAGE.ceiling);
  s.needs.hygiene = clampNeed(s.needs.hygiene - FORAGE.hygieneCost);
  events.push({ kind: "foraged", at: toIso(tMs), need: "hunger", detail: s.location.diorama });
}

function mess(s: State, tMs: number, events: EngineEvent[]): void {
  s.needs.hygiene = clampNeed(s.needs.hygiene - MESS_HYGIENE_DROP);
  s.lastMessAt = toIso(tMs);
  events.push({ kind: "mess", at: toIso(tMs), need: "hygiene" });
}

export function clearSickness(s: State, tMs: number, events: EngineEvent[], detail: string): void {
  s.sickness = null;
  events.push({ kind: "sickness_cleared", at: toIso(tMs), detail });
}
