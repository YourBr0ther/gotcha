/**
 * Shapes shared by the brain modules. The engine's own types come from
 * @gotcha/cpkmn and src/lib/sim; nothing here redefines a need or a stat.
 */

import type { EpisodicEvent, Personality, Relationship, SpeciesBehaviour, State } from "@gotcha/cpkmn";
import type { Mood } from "@/lib/sim";

/** What the prompts say about the species. Built from the row's frozen pokedex snapshot. */
export interface BrainSpeciesFacts {
  species: string;
  /** Display name of the species, title cased. */
  name: string;
  types: string[];
  habitat?: string | null;
  flavorTexts?: string[];
  pokedexLines?: string[];
  behaviour?: SpeciesBehaviour;
  spawnBiomes?: string[];
}

/** Activities the world can play; mirrors ACTIVITIES in src/world/bedrock/poser.ts minus cry and faint, which are not choices. */
export const BRAIN_ACTIVITIES = ["idle", "walk", "sleep", "swim", "fly"] as const;
export type BrainActivity = (typeof BRAIN_ACTIVITIES)[number];

/** Emote bubbles the world can draw; mirrors EmoteKind in src/world/api.ts. */
export const EMOTES = ["happy", "love", "sad", "angry", "question", "surprise", "sleepy", "music"] as const;
export type Emote = (typeof EMOTES)[number];

/** What the engine allows this turn. The model picks only from here. */
export interface Menu {
  activities: BrainActivity[];
  emotes: Emote[];
  /** Whether the pokemon may start misbehaving this turn (awake, bored or neglected). */
  canMisbehave: boolean;
}

export type DayPeriod = "night" | "morning" | "afternoon" | "evening";

export interface LocalTime {
  /** 0 to 23 in the trainer's timezone. */
  hour: number;
  period: DayPeriod;
  night: boolean;
}

export interface TickContext {
  pokemonId: string;
  /** Nickname or species name. */
  name: string;
  facts: BrainSpeciesFacts;
  personality: Personality;
  state: State;
  mood: Mood;
  now: string;
  local: LocalTime;
  summary: string;
  recentEvents: EpisodicEvent[];
  trainer: { id: string; name: string };
  relationship: Relationship | null;
  menu: Menu;
}

export interface TickPlan {
  activity: BrainActivity;
  emote?: Emote;
  line?: string;
  cry: boolean;
  misbehaving?: boolean;
}

export type Source = "model" | "rules";
