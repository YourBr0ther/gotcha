/**
 * A conversation turn. The trainer speaks (typed or transcribed), the
 * pokemon answers with a short translated gist, an emote and usually a
 * cry. Pokemon do not speak English, so the line is what the trainer
 * would understand from the cry, never a paragraph. Uses the talk model
 * and the talk budget; the rules answer with a canned gist when the model
 * does not.
 */

import { eq } from "drizzle-orm";
import type { LanguageModel } from "ai";
import { z } from "zod";
import type { Relationship } from "@gotcha/cpkmn";
import { schema, type Db } from "@/lib/db";
import type { PokemonRow, TrainerRow } from "@/lib/db/schema";
import { publish } from "@/lib/services/bus";
import { ServiceError } from "@/lib/services/errors";
import { assertTouchable, getPokemon } from "@/lib/services/pokemon";
import { pokemonView, type PokemonView } from "@/lib/services/views";
import { withBudget, type BudgetOptions, type FallbackReason } from "./budget";
import { BOND_PER_TALK, TRAINER_TEXT_MAX_CHARS } from "./constants";
import { EMOTE_EMOTION, insertEvent, setActivity } from "./events";
import { generateWithSdk, type GenerateFn } from "./generate";
import { allowedEmotes } from "./menu";
import { clipLine, systemPrompt, talkPrompt } from "./prompts";
import { talkModel } from "./provider";
import { rulesReply } from "./rules";
import { buildTickContext } from "./tick";
import { BRAIN_ACTIVITIES, EMOTES, type BrainActivity, type Emote, type Menu, type Source, type TickContext } from "./types";

export interface ConverseInput {
  db: Db;
  trainer: TrainerRow;
  row: PokemonRow;
  view: PokemonView;
  now: string;
}

export interface ConverseDeps {
  generate?: GenerateFn;
  model?: LanguageModel;
  budget?: BudgetOptions;
}

export interface ConverseReply {
  line: string;
  emote: Emote;
  cry: boolean;
  activity?: BrainActivity;
  source: Source;
  reason?: FallbackReason;
}

export const TalkOutput = z.object({
  line: z.string().max(1000),
  emote: z.enum(EMOTES),
  cry: z.boolean().default(true),
  activity: z.enum(BRAIN_ACTIVITIES).nullable().optional(),
  importance: z.number().int().min(1).max(3).default(1),
});

type ValidReply = { line: string; emote: Emote; cry: boolean; activity?: BrainActivity; importance: 1 | 2 | 3 };

export function validateReply(raw: unknown, menu: Menu): ValidReply | null {
  const parsed = TalkOutput.safeParse(raw);
  if (!parsed.success) return null;
  const out = parsed.data;
  const line = clipLine(out.line);
  if (!line) return null;
  if (!menu.emotes.includes(out.emote)) return null;
  if (out.activity && !menu.activities.includes(out.activity)) return null;
  return { line, emote: out.emote, cry: out.cry, ...(out.activity ? { activity: out.activity } : {}), importance: out.importance as 1 | 2 | 3 };
}

/** A new relationship starts warm but not close. */
export const NEW_BOND = 30;

export function bumpBond(rel: Relationship | undefined, trainerName: string, now: string, by = BOND_PER_TALK): Relationship {
  const base = rel ?? { bond: NEW_BOND, callsThem: trainerName, notes: [] };
  return { ...base, bond: Math.max(0, Math.min(100, base.bond + by)), callsThem: base.callsThem ?? trainerName, lastSeenAt: now };
}

export function cleanTrainerText(text: string): string {
  const clean = text.replace(/\s+/g, " ").trim();
  if (!clean) throw new ServiceError("bad_request", "say something first");
  return clean.slice(0, TRAINER_TEXT_MAX_CHARS);
}

export async function converse(input: ConverseInput, text: string, deps: ConverseDeps = {}): Promise<ConverseReply> {
  const said = cleanTrainerText(text);
  const { db, row, trainer, view, now } = input;
  const ctx: TickContext = await buildTickContext(input);
  // Being spoken to can surprise or puzzle any mood.
  ctx.menu.emotes = allowedEmotes(view.mood, ["surprise", "question"]);

  const generate = deps.generate ?? generateWithSdk;
  const outcome = await withBudget(
    db,
    row.id,
    "talk",
    async (signal) => {
      const model = deps.model ?? talkModel();
      const result = await generate({ model, system: systemPrompt(ctx), prompt: talkPrompt(ctx, said), schema: TalkOutput, signal });
      return { value: result.object, tokens: result.tokens };
    },
    { now, ...deps.budget },
  );

  let reply: ConverseReply;
  let importance: 1 | 2 | 3 = 1;
  const valid = outcome.source === "model" ? validateReply(outcome.value, ctx.menu) : null;
  if (valid) {
    importance = valid.importance;
    reply = { line: valid.line, emote: valid.emote, cry: valid.cry, ...(valid.activity ? { activity: valid.activity } : {}), source: "model" };
  } else {
    if (outcome.source === "rules" && outcome.reason === "error") console.warn(`talk for ${row.id} fell back to rules`, outcome.error);
    const canned = rulesReply(ctx);
    reply = { ...canned, source: "rules", reason: outcome.source === "rules" ? outcome.reason : "rejected" };
  }

  await insertEvent(db, {
    pokemonId: row.id,
    ts: now,
    kind: "talk",
    summary: `${trainer.displayName} said "${said.slice(0, 100)}"; ${view.name} answered "${reply.line}"`.slice(0, 280),
    importance,
    trainerId: trainer.id,
    emotion: EMOTE_EMOTION[reply.emote],
  });

  const memories = {
    ...row.memories,
    relationships: { ...row.memories.relationships, [trainer.id]: bumpBond(row.memories.relationships[trainer.id], trainer.displayName, now) },
  };
  await db.update(schema.pokemon).set({ memories, updatedAt: now }).where(eq(schema.pokemon.id, row.id));
  if (reply.activity && reply.activity !== "sleep" && reply.activity !== view.state.activity) await setActivity(db, row.id, reply.activity, now);

  publish(row.id, { type: "brain", pokemonId: row.id, activity: reply.activity, emote: reply.emote, dialogue: reply.line, cry: reply.cry, at: now });
  return reply;
}

/** The route's entry: ownership, status and the decayed view, then the turn. */
export async function talkTo(db: Db, trainer: TrainerRow, pokemonId: string, text: string, now = new Date().toISOString(), deps: ConverseDeps = {}): Promise<ConverseReply> {
  const row = await getPokemon(db, trainer.id, pokemonId);
  assertTouchable(row);
  if (row.status !== "home") throw new ServiceError("not_home", "a pokemon in the PC cannot hear you; withdraw it first");
  const view = await pokemonView(row, trainer, now);
  return converse({ db, trainer, row, view, now }, text, deps);
}
