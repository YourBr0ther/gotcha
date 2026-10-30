/**
 * The menu: which activities and emotes the engine allows right now. The
 * model never sees an option that is not on it, and anything it answers
 * that is not on it is thrown away.
 */

import type { Pokedex, State } from "@gotcha/cpkmn";
import { isNight, MOOD_LOW_THRESHOLD, SLEEPY_ENERGY, type Mood, type MoodLabel } from "@/lib/sim";
import { BRAIN_ACTIVITIES, EMOTES, type BrainActivity, type BrainSpeciesFacts, type DayPeriod, type Emote, type LocalTime, type Menu } from "./types";

/** What the brain knows about each diorama. Mirrors src/world/dioramas without importing the renderer. */
export const DIORAMA_FACTS: Record<string, { label: string; water: boolean; description: string }> = {
  meadow: { label: "the meadow", water: true, description: "a sunny lawn with a pond on the right, a fallen log and a wall of trees at the back" },
  forest: { label: "the forest", water: false, description: "tall trees, mossy ground, dappled light" },
  beach: { label: "the beach", water: true, description: "sand, shallow waves and a tide pool" },
  cave: { label: "the cave", water: false, description: "cool stone, a few glowing crystals, quiet" },
};

export const EMOTE_POOLS: Readonly<Record<MoodLabel, readonly Emote[]>> = {
  asleep: ["sleepy"],
  sick: ["sad"],
  hungry: ["sad", "angry", "question"],
  tired: ["sleepy", "sad"],
  grubby: ["sad", "angry"],
  bored: ["question", "sad", "angry"],
  lonely: ["sad", "question", "love"],
  sleepy: ["sleepy", "happy"],
  joyful: ["happy", "love", "music"],
  happy: ["happy", "music", "love"],
  content: ["happy", "question", "music"],
  glum: ["sad", "question"],
  miserable: ["sad", "angry"],
};

export function localTime(now: string, utcOffsetMinutes: number): LocalTime {
  const hour = new Date(Date.parse(now) + utcOffsetMinutes * 60_000).getUTCHours();
  const night = isNight(now, utcOffsetMinutes);
  let period: DayPeriod = "night";
  if (!night) period = hour < 12 ? "morning" : hour < 17 ? "afternoon" : "evening";
  return { hour, period, night };
}

export function canSwim(facts: BrainSpeciesFacts): boolean {
  const swim = facts.behaviour?.moving?.swim;
  return Boolean(swim?.canSwimInWater) && !swim?.avoidsWater;
}

export function canFly(facts: BrainSpeciesFacts): boolean {
  return Boolean(facts.behaviour?.moving?.fly?.canFly);
}

export function canSleep(facts: BrainSpeciesFacts): boolean {
  return facts.behaviour?.resting?.canSleep !== false;
}

/** Activities for the current state. Asleep means sleep and nothing else. */
export function allowedActivities(state: State, facts: BrainSpeciesFacts, local: LocalTime): BrainActivity[] {
  if (state.asleep) return ["sleep"];
  const out: BrainActivity[] = ["idle", "walk"];
  if (canSleep(facts) && (state.needs.energy < SLEEPY_ENERGY || local.night)) out.push("sleep");
  const diorama = DIORAMA_FACTS[state.location.diorama];
  if (diorama?.water && canSwim(facts)) out.push("swim");
  if (canFly(facts)) out.push("fly");
  return out.filter((a) => (BRAIN_ACTIVITIES as readonly string[]).includes(a));
}

export function allowedEmotes(mood: Mood, extra: readonly Emote[] = []): Emote[] {
  const pool = [...EMOTE_POOLS[mood.label], ...extra];
  return EMOTES.filter((e) => pool.includes(e));
}

export function buildMenu(state: State, mood: Mood, facts: BrainSpeciesFacts, local: LocalTime): Menu {
  const canMisbehave = !state.asleep && !state.sickness && (state.needs.fun < MOOD_LOW_THRESHOLD + 10 || state.needs.affection < MOOD_LOW_THRESHOLD);
  return { activities: allowedActivities(state, facts, local), emotes: allowedEmotes(mood), canMisbehave };
}

function titleCase(id: string): string {
  return id
    .split("_")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

/** Species facts from the frozen pokedex member of a row or file. */
export function factsFromPokedex(pokedex: Pokedex): BrainSpeciesFacts {
  return {
    species: pokedex.species,
    name: titleCase(pokedex.species),
    types: pokedex.types,
    habitat: pokedex.habitat ?? null,
    flavorTexts: pokedex.flavorTexts,
    pokedexLines: pokedex.cobblemonPokedexLines,
    behaviour: pokedex.behaviour,
    spawnBiomes: pokedex.spawnBiomes,
  };
}
