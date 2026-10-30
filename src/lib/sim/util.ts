import type { IsoDate, Needs, State } from "@gotcha/cpkmn";
import { NEED_NAMES } from "@gotcha/cpkmn";
import { DECAY_MULTIPLIER_MAX, DECAY_MULTIPLIER_MIN, HOUR, NEED_MAX, NEED_MIN } from "./constants";

export function parseIso(iso: IsoDate): number {
  const ms = Date.parse(iso);
  if (Number.isNaN(ms)) throw new Error(`Invalid ISO date: ${iso}`);
  return ms;
}

export function toIso(ms: number): IsoDate {
  return new Date(ms).toISOString();
}

export function hoursOf(ms: number): number {
  return ms / HOUR;
}

export function clamp(value: number, min: number, max: number): number {
  return value < min ? min : value > max ? max : value;
}

export function clampNeed(value: number): number {
  return clamp(value, NEED_MIN, NEED_MAX);
}

/** Personality and species multipliers, missing needs treated as 1. */
export function clampMultipliers(multipliers: Partial<Needs> | undefined): Needs {
  const out = {} as Needs;
  for (const need of NEED_NAMES) {
    const raw = multipliers?.[need];
    out[need] = clamp(typeof raw === "number" && Number.isFinite(raw) ? raw : 1, DECAY_MULTIPLIER_MIN, DECAY_MULTIPLIER_MAX);
  }
  return out;
}

/** A copy deep enough that no mutation of the result reaches the input. */
export function cloneState(state: State): State {
  return {
    ...state,
    needs: { ...state.needs },
    status: [...state.status],
    sickness: state.sickness ? { ...state.sickness } : state.sickness,
    location: { ...state.location },
    flags: state.flags ? { ...state.flags } : state.flags,
  };
}
