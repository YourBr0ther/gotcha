/**
 * Mood is derived, never stored. It picks the idle animation set and the
 * emote pool the brain may choose from.
 */

import type { IsoDate, NeedName, State } from "@gotcha/cpkmn";
import { NEED_NAMES } from "@gotcha/cpkmn";
import {
  MINUTE,
  MOOD_BANDS,
  MOOD_LOW_THRESHOLD,
  MOOD_TEMPERAMENT_BIAS,
  MOOD_WEIGHTS,
  NEED_MAX,
  NEED_MIN,
  NIGHT_END_HOUR,
  NIGHT_START_HOUR,
  SLEEPY_ENERGY,
} from "./constants";
import type { Mood, MoodLabel, SpeciesFacts } from "./types";
import { clamp, parseIso } from "./util";

const LOW_LABELS: Readonly<Partial<Record<NeedName, MoodLabel>>> = {
  hunger: "hungry",
  energy: "tired",
  hygiene: "grubby",
  fun: "bored",
  affection: "lonely",
};

export interface MoodOptions {
  /** Minutes east of UTC for the trainer, so night means their night. Default 0. */
  utcOffsetMinutes?: number;
}

export function moodScore(state: State, species: SpeciesFacts): number {
  let score = 0;
  for (const need of NEED_NAMES) score += MOOD_WEIGHTS[need] * state.needs[need];
  score += species.temperament ? (MOOD_TEMPERAMENT_BIAS[species.temperament] ?? 0) : 0;
  return clamp(score, NEED_MIN, NEED_MAX);
}

export function isNight(now: IsoDate, utcOffsetMinutes = 0): boolean {
  const local = new Date(parseIso(now) + utcOffsetMinutes * MINUTE);
  const hour = local.getUTCHours();
  return NIGHT_START_HOUR > NIGHT_END_HOUR
    ? hour >= NIGHT_START_HOUR || hour < NIGHT_END_HOUR
    : hour >= NIGHT_START_HOUR && hour < NIGHT_END_HOUR;
}

/** `state` should already be decayed to `now`. */
export function mood(state: State, species: SpeciesFacts, now: IsoDate, options: MoodOptions = {}): Mood {
  const score = moodScore(state, species);
  let lowestNeed: NeedName | null = null;
  for (const need of NEED_NAMES) {
    if (need === "health") continue;
    if (lowestNeed === null || state.needs[need] < state.needs[lowestNeed]) lowestNeed = need;
  }

  if (state.asleep) return { label: "asleep", score, lowestNeed };
  if (state.sickness) return { label: "sick", score, lowestNeed };
  if (lowestNeed && state.needs[lowestNeed] < MOOD_LOW_THRESHOLD) {
    return { label: LOW_LABELS[lowestNeed] ?? "glum", score, lowestNeed };
  }
  if (state.needs.energy < SLEEPY_ENERGY && isNight(now, options.utcOffsetMinutes)) {
    return { label: "sleepy", score, lowestNeed };
  }
  const band = MOOD_BANDS.find((b) => score >= b.atLeast) ?? MOOD_BANDS[MOOD_BANDS.length - 1];
  return { label: band.label, score, lowestNeed };
}
