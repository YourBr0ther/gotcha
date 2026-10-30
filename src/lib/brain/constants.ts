/**
 * Budgets and limits for the brain. The sim engine owns balance numbers in
 * src/lib/sim/constants.ts; these are the brain's own knobs and live here so
 * the engine never imports the brain.
 */

import { SUMMARY_MAX_CHARS } from "@gotcha/cpkmn";

/** Model calls one pokemon may spend per UTC day. A watched pokemon ticks every three minutes, so 200 covers ten hours on screen. */
export const TICK_CALLS_PER_DAY = 200;
export const TALK_CALLS_PER_DAY = 80;
/** Prompt plus completion tokens per pokemon per day, all kinds together. */
export const TOKENS_PER_DAY = 400_000;

/** A model call that takes longer than this loses to the rules. */
export const BRAIN_TIMEOUT_MS = 8_000;

/** Pokemon speak in cries; a line is a translated gist, not a speech. */
export const LINE_MAX_CHARS = 80;
/** The longest thing a trainer can say in one turn. */
export const TRAINER_TEXT_MAX_CHARS = 500;
/** How many recent events a tick prompt carries. */
export const RECENT_EVENTS = 10;
/** memories.summary stays under this, from the file format. */
export const SUMMARY_MAX = SUMMARY_MAX_CHARS;
/** relationships[trainer].notes keeps at most this many. */
export const RELATIONSHIP_NOTES_MAX = 10;
/** Most a day's events can move a relationship bond, either way. */
export const BOND_DAILY_SWING = 8;
/** Bond gained each time the trainer talks to the pokemon. */
export const BOND_PER_TALK = 1;
