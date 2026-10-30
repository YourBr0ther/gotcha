/**
 * Brain cadence. An active pokemon with an open stream is due every few
 * minutes, an unwatched active pokemon hourly, PC pokemon never. Last tick
 * times live in process memory: a restart makes everything due once, which
 * is the right first move after a deploy anyway.
 */

import { and, eq } from "drizzle-orm";
import { HOUR, MINUTE } from "@/lib/sim";
import { getDb, schema, type Db } from "@/lib/db";
import type { PokemonRow, TrainerRow } from "@/lib/db/schema";
import { brainTick } from "./brain-hook";
import { publish, watcherCount } from "./bus";
import { settle } from "./care";

export const WATCHED_TICK_INTERVAL = 3 * MINUTE;
export const UNWATCHED_TICK_INTERVAL = HOUR;
export const SCHEDULER_POLL = MINUTE;

export interface DueTick {
  pokemonId: string;
  trainerId: string;
  watched: boolean;
  lastTickAt: string | null;
}

interface SchedulerState {
  lastTick: Map<string, number>;
  timer: ReturnType<typeof setInterval> | null;
  running: boolean;
}

const KEY = Symbol.for("gotcha.scheduler");

function state(): SchedulerState {
  const holder = globalThis as { [KEY]?: SchedulerState };
  holder[KEY] ??= { lastTick: new Map(), timer: null, running: false };
  return holder[KEY];
}

export function markTicked(pokemonId: string, now: string): void {
  state().lastTick.set(pokemonId, Date.parse(now));
}

export function lastTickAt(pokemonId: string): string | null {
  const ms = state().lastTick.get(pokemonId);
  return ms === undefined ? null : new Date(ms).toISOString();
}

export function resetScheduler(): void {
  const s = state();
  s.lastTick.clear();
  if (s.timer) clearInterval(s.timer);
  s.timer = null;
  s.running = false;
}

/** Pure given the clock and the watcher counts: which active pokemon get a brain tick now. */
export function isDue(pokemonId: string, now: string, watched = watcherCount(pokemonId) > 0): boolean {
  const last = state().lastTick.get(pokemonId);
  if (last === undefined) return true;
  const interval = watched ? WATCHED_TICK_INTERVAL : UNWATCHED_TICK_INTERVAL;
  return Date.parse(now) - last >= interval;
}

export async function dueForTick(db: Db, now = new Date().toISOString()): Promise<DueTick[]> {
  const actives = await db
    .select({ id: schema.pokemon.id, trainerId: schema.pokemon.trainerId })
    .from(schema.pokemon)
    .where(and(eq(schema.pokemon.active, true), eq(schema.pokemon.status, "home")));
  const due: DueTick[] = [];
  for (const p of actives) {
    const watched = watcherCount(p.id) > 0;
    if (isDue(p.id, now, watched)) due.push({ pokemonId: p.id, trainerId: p.trainerId, watched, lastTickAt: lastTickAt(p.id) });
  }
  return due;
}

/** Settles each due pokemon, hands it to the brain hook, and publishes whatever the brain chose. */
export async function runDueTicks(db: Db, now = new Date().toISOString()): Promise<DueTick[]> {
  const due = await dueForTick(db, now);
  for (const tick of due) {
    markTicked(tick.pokemonId, now);
    const trainer: TrainerRow | undefined = await db.query.trainer.findFirst({ where: eq(schema.trainer.id, tick.trainerId) });
    if (!trainer) continue;
    try {
      const view = await settle(db, trainer, tick.pokemonId, now);
      const row: PokemonRow | undefined = await db.query.pokemon.findFirst({ where: eq(schema.pokemon.id, tick.pokemonId) });
      if (!row) continue;
      const result = await brainTick({ db, trainer, row, view, now, watched: tick.watched });
      if (result) publish(tick.pokemonId, { type: "brain", pokemonId: tick.pokemonId, ...result, at: now });
    } catch (error) {
      console.error(`brain tick failed for ${tick.pokemonId}`, error);
    }
  }
  return due;
}

/** Starts the poll loop once per process. The stream route calls this when a stream opens. */
export function startScheduler(db: Db = getDb(), pollMs = SCHEDULER_POLL): void {
  const s = state();
  if (s.timer) return;
  s.timer = setInterval(() => {
    if (s.running) return;
    s.running = true;
    runDueTicks(db)
      .catch((error) => console.error("scheduler poll failed", error))
      .finally(() => {
        s.running = false;
      });
  }, pollMs);
  s.timer.unref?.();
}
