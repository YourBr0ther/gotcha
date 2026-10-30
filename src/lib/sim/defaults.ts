/**
 * Neutral fixtures. The balance script and the tests use them, and
 * trainer-api can use freshState for a new starter.
 */

import type { IsoDate, Needs, Personality, State, Stats, ExperienceGroup } from "@gotcha/cpkmn";
import { NEED_MAX } from "./constants";
import type { SpeciesFacts } from "./types";

export function fullNeeds(): Needs {
  return { hunger: NEED_MAX, energy: NEED_MAX, hygiene: NEED_MAX, fun: NEED_MAX, affection: NEED_MAX, health: NEED_MAX };
}

export function neutralMultipliers(): Needs {
  return { hunger: 1, energy: 1, hygiene: 1, fun: 1, affection: 1, health: 1 };
}

export function freshState(now: IsoDate, needs: Partial<Needs> = {}): State {
  return {
    lastTickAt: now,
    needs: { ...fullNeeds(), ...needs },
    status: [],
    asleep: false,
    sleepStartedAt: null,
    lastMessAt: now,
    sickness: null,
    location: { diorama: "meadow" },
    activity: "idle",
    ageDays: 0,
    careMistakes: 0,
    flags: {},
  };
}

export function neutralPersonality(): Personality {
  return {
    traits: [],
    temperament: "calm",
    likes: [],
    dislikes: [],
    preferences: {},
    decayMultipliers: neutralMultipliers(),
    voice: {},
    promptSeed: 0,
  };
}

export function neutralSpecies(species = "test", experienceGroup: ExperienceGroup = "medium_fast"): SpeciesFacts {
  return { species, experienceGroup };
}

export function freshStats(experienceGroup: ExperienceGroup = "medium_fast"): Stats {
  return {
    level: 1,
    experience: 0,
    experienceGroup,
    friendship: 70,
    ivs: { hp: 0, atk: 0, def: 0, spa: 0, spd: 0, spe: 0 },
    evs: { hp: 0, atk: 0, def: 0, spa: 0, spd: 0, spe: 0 },
    moves: [],
    evolution: { blocked: false, declinedUntil: null, stage: 1 },
  };
}
