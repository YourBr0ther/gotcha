/**
 * Engine-only types. The pokemon's own shapes (State, Personality, Stats,
 * Needs, Inventory) come from @gotcha/cpkmn and are not redefined
 * here.
 */

import type { ExperienceGroup, IsoDate, NeedName, Needs } from "@gotcha/cpkmn";
import type { StoreItemId } from "./constants";

export type Temperament = "playful" | "calm" | "bold" | "timid" | "grumpy";

export type EvolutionTrigger = "level" | "friendship" | "item" | "trade";

/** One edge of a species' evolution chain, in terms the engine can check. */
export interface EvolutionRule {
  to: string;
  trigger: EvolutionTrigger;
  minLevel?: number;
  minFriendship?: number;
  /** Store item id that must be in the trainer's bag for item triggers. */
  item?: string;
}

/** What the engine needs to know about a species. Built by pokedex-data from the frozen Pokedex. */
export interface SpeciesFacts {
  species: string;
  experienceGroup: ExperienceGroup;
  temperament?: Temperament;
  /** Multiplies base decay per need. Clamped like personality. Missing needs are 1. */
  decayModifiers?: Partial<Needs>;
  evolutions?: readonly EvolutionRule[];
}

/** A temporary change to one need's decay, such as a toy. Stored by the caller, not in State. */
export interface ActiveModifier {
  need: NeedName;
  factor: number;
  until: IsoDate;
  source?: string;
}

export type CareAction = "feed" | "play" | "groom" | "rest" | "wake" | "medicine" | "discipline" | "pet";

export type EngineEventKind =
  | "fell_asleep"
  | "woke_up"
  | "need_low"
  | "mess"
  | "sickness_started"
  | "sickness_worsened"
  | "sickness_cleared"
  | "care"
  | "care_mistake"
  | "refused"
  | "milestone"
  | "level_up";

export interface EngineEvent {
  kind: EngineEventKind;
  at: IsoDate;
  need?: NeedName;
  detail?: string;
}

export type MilestoneKind = "level_up" | "evolution" | "recovery" | "first_import";

export type StoreCategory = "berry" | "poffin" | "curry" | "potion" | "medicine" | "toy" | "decoration" | "diorama" | "key";

export interface ItemEffects {
  /** Added to each need, clamped to the need range. */
  fill?: Partial<Needs>;
  cureSickness?: boolean;
  /** Decay multiplier the item grants when used in play. */
  modifier?: { need: NeedName; factor: number; duration: number };
  /** Diorama id this item unlocks. */
  unlock?: string;
  flavors?: readonly string[];
}

export interface StoreItem {
  id: StoreItemId;
  name: string;
  category: StoreCategory;
  price: number;
  effects: ItemEffects;
}

/** What a mini-game module hands back. score is 0 to 1. */
export interface MiniGameResult {
  game: string;
  score: number;
  durationMs: number;
  completed: boolean;
}

/** Running totals for the current day, kept by the caller. */
export interface DayTotals {
  gamesPlayed: number;
  bytesEarned: number;
}

export type MoodLabel =
  | "asleep"
  | "sick"
  | "hungry"
  | "tired"
  | "grubby"
  | "bored"
  | "lonely"
  | "sleepy"
  | "joyful"
  | "happy"
  | "content"
  | "glum"
  | "miserable";

export interface Mood {
  label: MoodLabel;
  /** 0 to 100 weighted mean of the needs after temperament. */
  score: number;
  lowestNeed: NeedName | null;
}
