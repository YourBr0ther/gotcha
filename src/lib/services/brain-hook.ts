/**
 * Where the pokemon-brain plugs in. The scheduler calls brainTick on its
 * cadence and the roll-up calls rollUpMemories nightly; both are no-ops
 * until pokemon-brain fills them. Rules-first: a null result means "nothing
 * to add", and the pokemon keeps eating and sleeping through the engine.
 */

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

export const brainTick: BrainTick = async () => null;

export const rollUpMemories: RollUpMemories = async () => {};
