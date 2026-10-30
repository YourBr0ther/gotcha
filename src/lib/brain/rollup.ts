/**
 * The nightly roll-up. Rewrites memories.summary in the pokemon's voice,
 * promotes the day's event rows into memories.episodic, moves the
 * relationship with the trainer, and writes one journal page as an event
 * row so the Journal screen has a dated entry to badge. With no model the
 * summary is the day's events joined in order of importance, which reads
 * flat but loses nothing.
 */

import { eq } from "drizzle-orm";
import type { LanguageModel } from "ai";
import { z } from "zod";
import { trimEpisodic, type EpisodicEvent, type Memories, type Relationship } from "@gotcha/cpkmn";
import { schema, type Db } from "@/lib/db";
import type { EventRow, PokemonRow, TrainerRow } from "@/lib/db/schema";
import { displayName, localDay } from "@/lib/services/views";
import { withBudget, type BudgetOptions, type FallbackReason } from "./budget";
import { BOND_DAILY_SWING, RELATIONSHIP_NOTES_MAX, SUMMARY_MAX } from "./constants";
import { NEW_BOND } from "./converse";
import { insertEvent, toEpisodic } from "./events";
import { generateWithSdk, type GenerateFn } from "./generate";
import { factsFromPokedex } from "./menu";
import { rollupPrompt, systemPrompt, type RollupContext } from "./prompts";
import { talkModel } from "./provider";
import type { Source } from "./types";

export interface RollupInput {
  db: Db;
  trainer: TrainerRow;
  row: PokemonRow;
  /** Event rows not yet folded into memories. The caller marks them rolled up afterwards. */
  events: EventRow[];
  now: string;
}

export interface RollupDeps {
  generate?: GenerateFn;
  model?: LanguageModel;
  budget?: BudgetOptions;
}

export interface RollupResult {
  day: string;
  summary: string;
  memories: Memories;
  journal: EventRow;
  source: Source;
  reason?: FallbackReason;
}

export const RollupOutput = z.object({
  summary: z.string().max(4000),
  callsThem: z.string().max(40).nullable().optional(),
  notes: z.array(z.string().max(200)).max(3).default([]),
  bondDelta: z.number().int().min(-5).max(5).default(0),
});

/** The summary stays under the file limit; a long one ends at a sentence when it can. */
export function clipSummary(text: string, max = SUMMARY_MAX): string {
  const clean = text.replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim();
  if (clean.length < max) return clean;
  const cut = clean.slice(0, max - 2);
  const stop = Math.max(cut.lastIndexOf(". "), cut.lastIndexOf("! "), cut.lastIndexOf("? "));
  return `${stop > max / 2 ? cut.slice(0, stop + 1) : cut.trimEnd()}…`;
}

function byWeight(a: EpisodicEvent, b: EpisodicEvent): number {
  return b.importance - a.importance || a.ts.localeCompare(b.ts);
}

/** Today gets at most this much of the summary when there is a past to keep. */
const TODAY_SHARE = 0.6;

/** Events joined in order of importance, with the old summary behind them. */
export function rulesSummary(ctx: RollupContext): string {
  const opener = ctx.personality.voice.chatter ? `(${ctx.personality.voice.chatter})` : "";
  const today = [...ctx.dayEvents].sort(byWeight).map((e) => e.summary.replace(/\.$/, ""));
  const head = today.length > 0 ? `${ctx.day}: ${today.join("; ")}.` : `${ctx.day}: a quiet day, nothing much happened.`;
  // The previous summary already starts with its own opener; drop it so they do not stack.
  const previous = ctx.summary.replace(/^\([^)]*\)\s*/, "").trim();
  if (!previous) return clipSummary([opener, head].filter(Boolean).join(" "));
  const fresh = clipSummary([opener, head].filter(Boolean).join(" "), Math.floor(SUMMARY_MAX * TODAY_SHARE));
  const room = SUMMARY_MAX - fresh.length - 2;
  return clipSummary(`${fresh}\n\n${clipSummary(previous, room)}`);
}

/** How a day's events move the bond without a model: care and play up, neglect and mistakes down, within a daily swing. */
export function rulesBondDelta(events: readonly EpisodicEvent[], trainerId: string): number {
  let delta = 0;
  for (const e of events) {
    if (e.trainerId !== trainerId && e.kind !== "neglect") continue;
    switch (e.kind) {
      case "care":
        delta += e.emotion === "upset" ? -2 : 1;
        break;
      case "play":
      case "talk":
        delta += 1;
        break;
      case "neglect":
        delta -= 1;
        break;
      case "milestone":
      case "evolution":
        delta += 2;
        break;
      default:
        break;
    }
  }
  return Math.max(-BOND_DAILY_SWING, Math.min(BOND_DAILY_SWING, delta));
}

export function updateRelationship(prev: Relationship | undefined, trainerName: string, day: string, events: readonly EpisodicEvent[], change: { bondDelta: number; callsThem?: string | null; notes: string[] }, now: string): Relationship {
  const base: Relationship = prev ?? { bond: NEW_BOND, callsThem: trainerName, notes: [] };
  const seen = events.filter((e) => e.trainerId !== undefined);
  const fallbackNote = seen.length > 0 ? [`${day}: ${[...seen].sort(byWeight)[0].summary}`] : [];
  const added = (change.notes.length > 0 ? change.notes : fallbackNote).map((n) => n.slice(0, 200));
  const notes = [...(base.notes ?? []), ...added].slice(-RELATIONSHIP_NOTES_MAX);
  return {
    bond: Math.max(0, Math.min(100, Math.round(base.bond + change.bondDelta))),
    callsThem: (change.callsThem?.trim() || base.callsThem || trainerName).slice(0, 40),
    notes,
    lastSeenAt: seen.length > 0 ? seen[seen.length - 1].ts : (base.lastSeenAt ?? now),
  };
}

export async function rollupDay(input: RollupInput, deps: RollupDeps = {}): Promise<RollupResult> {
  const { db, row, trainer, now } = input;
  const day = localDay(trainer.timezone, now);
  const dayEvents = input.events.map(toEpisodic);
  const ctx: RollupContext = {
    name: displayName(row),
    facts: factsFromPokedex(row.pokedex),
    personality: row.personality,
    summary: row.memories.summary,
    dayEvents,
    trainer: { id: trainer.id, name: trainer.displayName },
    relationship: row.memories.relationships[trainer.id] ?? null,
    day,
  };

  const generate = deps.generate ?? generateWithSdk;
  const outcome = await withBudget(
    db,
    row.id,
    "talk",
    async (signal) => {
      const model = deps.model ?? talkModel();
      const result = await generate({ model, system: systemPrompt(ctx), prompt: rollupPrompt(ctx), schema: RollupOutput, signal });
      return { value: result.object, tokens: result.tokens };
    },
    { now, ...deps.budget },
  );

  let source: Source = "rules";
  let reason: FallbackReason | undefined;
  let summary: string;
  let change: { bondDelta: number; callsThem?: string | null; notes: string[] };
  const parsed = outcome.source === "model" ? RollupOutput.safeParse(outcome.value) : null;
  if (parsed?.success && parsed.data.summary.trim()) {
    source = "model";
    summary = clipSummary(parsed.data.summary);
    change = { bondDelta: parsed.data.bondDelta, callsThem: parsed.data.callsThem, notes: parsed.data.notes };
  } else {
    reason = outcome.source === "rules" ? outcome.reason : "rejected";
    if (outcome.source === "rules" && outcome.reason === "error") console.warn(`roll-up for ${row.id} fell back to rules`, outcome.error);
    summary = rulesSummary(ctx);
    change = { bondDelta: rulesBondDelta(dayEvents, trainer.id), notes: [] };
  }

  const journal = await insertEvent(db, {
    pokemonId: row.id,
    ts: now,
    kind: "other",
    // The rules summary already opens with the date; do not print it twice.
    summary: `Journal, ${day}: ${summary.startsWith(`${day}: `) ? summary.slice(day.length + 2) : summary}`.slice(0, 280),
    importance: 2,
    trainerId: null,
    emotion: "reflective",
    rolledUp: true,
  });

  const memories: Memories = {
    summary,
    episodic: trimEpisodic([...row.memories.episodic, ...dayEvents, toEpisodic(journal)]),
    relationships: {
      ...row.memories.relationships,
      [trainer.id]: updateRelationship(row.memories.relationships[trainer.id], trainer.displayName, day, dayEvents, change, now),
    },
  };
  await db.update(schema.pokemon).set({ memories, updatedAt: now }).where(eq(schema.pokemon.id, row.id));

  return { day, summary, memories, journal, source, ...(reason ? { reason } : {}) };
}
