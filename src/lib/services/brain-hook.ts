/**
 * Where the pokemon-brain plugs in. The scheduler calls brainTick on its
 * cadence and the roll-up calls rollUpMemories nightly. Rules first: the
 * tick always answers, by model when the key and the budget allow and by
 * rules otherwise, so the pokemon keeps choosing even with no key at all.
 */

import { decideTick } from "@/lib/brain/tick";
import { rollupDay } from "@/lib/brain/rollup";
import type { Db } from "@/lib/db";
import type { EventRow, PokemonRow, TrainerRow } from "@/lib/db/schema";
import type { PokemonView } from "./views";

export interface BrainTickInput {
  db: Db;
  trainer: TrainerRow;
  row: PokemonRow;
  /** Decayed and persisted as of now. */
  view: PokemonView;
  now: string;
  /** True when at least one stream is open on this pokemon. */
  watched: boolean;
}

/** A plan the engine has already allowed. Never a stat. */
export interface BrainTickResult {
  activity?: string;
  emote?: string;
  dialogue?: string;
  cry?: boolean;
  source?: "model" | "rules";
}

export type BrainTick = (input: BrainTickInput) => Promise<BrainTickResult | null>;

export interface RollUpInput {
  db: Db;
  trainer: TrainerRow;
  row: PokemonRow;
  /** Events not yet folded into memories.summary. */
  events: EventRow[];
  now: string;
}

export type RollUpMemories = (input: RollUpInput) => Promise<void>;

/** The scheduler publishes the result, so the tick itself stays quiet on the bus. */
export const brainTick: BrainTick = async (input) => {
  const decision = await decideTick(input, { publish: false });
  return { activity: decision.activity, emote: decision.emote, dialogue: decision.line, cry: decision.cry, source: decision.source };
};

export const rollUpMemories: RollUpMemories = async (input) => {
  await rollupDay(input);
};
