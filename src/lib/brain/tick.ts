/**
 * The decision tick. Builds the context from the row and the view, asks
 * the model for a plan inside the budget, checks the answer against the
 * menu, and falls back to the rules when anything is off. Then it writes
 * what the plan implies: a talk event when there is a line, the
 * misbehaving flag, the activity, and sleep when the pokemon chose it.
 */

import { eq } from "drizzle-orm";
import type { LanguageModel } from "ai";
import { z } from "zod";
import { CARE, type EngineEvent } from "@/lib/sim";
import { schema, type Db } from "@/lib/db";
import type { PokemonRow, TrainerRow } from "@/lib/db/schema";
import { publish } from "@/lib/services/bus";
import { logEngineEvents } from "@/lib/services/pokemon";
import { pokemonView, utcOffsetMinutes, type PokemonView } from "@/lib/services/views";
import { withBudget, type BudgetOptions, type FallbackReason } from "./budget";
import { EMOTE_EMOTION, insertEvent, recentEvents, setActivity, setMisbehaving } from "./events";
import { generateWithSdk, type GenerateFn } from "./generate";
import { buildMenu, factsFromPokedex, localTime } from "./menu";
import { clipLine, systemPrompt, tickPrompt } from "./prompts";
import { tickModel } from "./provider";
import { rulesTick } from "./rules";
import { BRAIN_ACTIVITIES, EMOTES, type Menu, type Source, type TickContext, type TickPlan } from "./types";

export interface TickInput {
  db: Db;
  trainer: TrainerRow;
  row: PokemonRow;
  view: PokemonView;
  now: string;
  /** Whether a trainer is looking. A line said to nobody is logged as `other`, not `talk`. */
  watched: boolean;
}

export interface TickDeps {
  generate?: GenerateFn;
  /** Resolved lazily from the env when omitted, and only once the budget says go. */
  model?: LanguageModel;
  budget?: BudgetOptions;
  /** Publish the brain message on the bus. The scheduler hook turns this off and publishes the result itself. */
  publish?: boolean;
}

export interface TickDecision extends TickPlan {
  source: Source;
  reason?: FallbackReason;
}

/** What the model may answer. The menu check happens after parsing. */
export const TickOutput = z.object({
  activity: z.enum(BRAIN_ACTIVITIES),
  emote: z.enum(EMOTES).nullable().optional(),
  // Long lines are clipped, not refused; the limit here only stops a runaway answer.
  line: z.string().max(1000).nullable().optional(),
  cry: z.boolean().default(false),
  misbehaving: z.boolean().nullable().optional(),
});

export async function buildTickContext(input: Pick<TickInput, "db" | "trainer" | "row" | "view" | "now">): Promise<TickContext> {
  const { row, view, trainer, now } = input;
  const facts = factsFromPokedex(row.pokedex);
  const local = localTime(now, utcOffsetMinutes(trainer.timezone, now));
  const state = view.state;
  const menu = buildMenu(state, view.mood, facts, local);
  // Sleep is offered on the same gate the engine's rest action uses.
  if (!state.asleep && state.needs.energy >= CARE.rest.refuseEnergy) menu.activities = menu.activities.filter((a) => a !== "sleep");
  return {
    pokemonId: row.id,
    name: view.name,
    facts,
    personality: row.personality,
    state,
    mood: view.mood,
    now,
    local,
    summary: row.memories.summary,
    recentEvents: await recentEvents(input.db, row.id),
    trainer: { id: trainer.id, name: trainer.displayName },
    relationship: row.memories.relationships[trainer.id] ?? null,
    menu,
  };
}

/** The model's answer against the menu. Null means the answer is not usable and the rules decide. */
export function validatePlan(raw: unknown, menu: Menu): TickPlan | null {
  const parsed = TickOutput.safeParse(raw);
  if (!parsed.success) return null;
  const out = parsed.data;
  if (!menu.activities.includes(out.activity)) return null;
  if (out.emote && !menu.emotes.includes(out.emote)) return null;
  const plan: TickPlan = { activity: out.activity, cry: out.cry };
  if (out.emote) plan.emote = out.emote;
  const line = clipLine(out.line);
  if (line) plan.line = line;
  if (out.misbehaving === true && menu.canMisbehave) plan.misbehaving = true;
  return plan;
}

/** Asks the model or the rules for a plan. No writes. */
export async function planTick(ctx: TickContext, db: Db, deps: TickDeps = {}): Promise<TickDecision> {
  const generate = deps.generate ?? generateWithSdk;
  const outcome = await withBudget(
    db,
    ctx.pokemonId,
    "tick",
    async (signal) => {
      const model = deps.model ?? tickModel();
      const result = await generate({ model, system: systemPrompt(ctx), prompt: tickPrompt(ctx), schema: TickOutput, signal });
      return { value: result.object, tokens: result.tokens };
    },
    { now: ctx.now, ...deps.budget },
  );
  if (outcome.source === "model") {
    const plan = validatePlan(outcome.value, ctx.menu);
    if (plan) return { ...plan, source: "model" };
    return { ...rulesTick(ctx), source: "rules", reason: "rejected" };
  }
  if (outcome.reason === "error") console.warn(`brain tick for ${ctx.pokemonId} fell back to rules`, outcome.error);
  return { ...rulesTick(ctx), source: "rules", reason: outcome.reason };
}

/** Puts the pokemon to sleep because it chose to. Same gate as the rest action, no experience or friendship. */
async function applySleep(db: Db, input: TickInput): Promise<PokemonView | null> {
  const { row, trainer, now } = input;
  return db.transaction(async (tx) => {
    const [locked] = await tx.select().from(schema.pokemon).where(eq(schema.pokemon.id, row.id)).for("update");
    if (!locked || locked.status !== "home" || locked.state.asleep || locked.state.needs.energy >= CARE.rest.refuseEnergy) return null;
    const state = { ...locked.state, asleep: true, sleepStartedAt: now, activity: "sleep" };
    await tx.update(schema.pokemon).set({ state, updatedAt: now }).where(eq(schema.pokemon.id, row.id));
    const events: EngineEvent[] = [{ kind: "fell_asleep", at: now, detail: "chose" }];
    await logEngineEvents(tx, locked, events, null, null);
    return pokemonView({ ...locked, state }, trainer, now);
  });
}

/** Writes what the plan implies and tells the watchers. */
export async function applyTick(input: TickInput, decision: TickDecision, deps: Pick<TickDeps, "publish"> = {}): Promise<void> {
  const { db, row, trainer, now, view } = input;
  if (decision.line) {
    await insertEvent(db, {
      pokemonId: row.id,
      ts: now,
      kind: input.watched ? "talk" : "other",
      summary: `${view.name} said "${decision.line}"`,
      importance: 1,
      trainerId: input.watched ? trainer.id : null,
      emotion: decision.emote ? EMOTE_EMOTION[decision.emote] : null,
    });
  }
  if (decision.misbehaving && !view.state.flags?.misbehaving) await setMisbehaving(db, row.id, true, now);

  let freshView: PokemonView | null = null;
  if (decision.activity === "sleep" && !view.state.asleep) freshView = await applySleep(db, input);
  else if (decision.activity !== view.state.activity) await setActivity(db, row.id, decision.activity, now);

  // Watchers always learn about a state change; the brain message itself is optional because the scheduler sends its own.
  if (freshView) publish(row.id, { type: "state", view: freshView, cause: "brain:sleep" });
  if (deps.publish ?? true) {
    publish(row.id, { type: "brain", pokemonId: row.id, activity: decision.activity, emote: decision.emote, dialogue: decision.line, cry: decision.cry, at: now });
  }
}

export async function decideTick(input: TickInput, deps: TickDeps = {}): Promise<TickDecision> {
  const ctx = await buildTickContext(input);
  const decision = await planTick(ctx, input.db, deps);
  await applyTick(input, decision, deps);
  return decision;
}
