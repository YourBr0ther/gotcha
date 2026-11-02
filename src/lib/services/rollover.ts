/**
 * The nightly roll-over, hit by a CronJob through /api/internal/rollover.
 * Per trainer: settle the party so the day's engine events are logged, pay
 * the stipend, hand the unrolled events to the memory roll-up hook one
 * local day at a time, then mark them rolled_up. Also expires trade offers
 * past their expiry.
 */

import { and, eq, inArray, like, lte } from "drizzle-orm";
import { JOURNAL_PREFIX } from "@/lib/brain/rollup";
import { schema, type Db } from "@/lib/db";
import type { EventRow, PokemonRow, TrainerRow } from "@/lib/db/schema";
import { rollUpMemories } from "./brain-hook";
import { settle } from "./care";
import { grantStipend } from "./economy";
import { listOwned, partyOf } from "./pokemon";
import { localDay } from "./views";

export interface RolloverResult {
  at: string;
  trainers: number;
  stipends: Array<{ trainerId: string; day: string; bytes: number; paid: boolean }>;
  settled: number;
  eventsRolledUp: number;
  tradesExpired: number;
}

/** Pending events in order, split by the trainer's local day so each roll-up writes one day's page. */
export function byLocalDay(events: readonly EventRow[], timezone: string): EventRow[][] {
  const days = new Map<string, EventRow[]>();
  for (const e of events) {
    const day = localDay(timezone, new Date(e.ts).toISOString());
    const list = days.get(day);
    if (list) list.push(e);
    else days.set(day, [e]);
  }
  return [...days.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([, list]) => list);
}

/**
 * Rolls up every finished day this pokemon has logged and not yet
 * remembered, one day at a time, oldest first. The current local day stays
 * pending for tomorrow night, so a day gets exactly one page however early
 * the job runs. Returns how many rows it folded.
 */
export async function rollUpPending(db: Db, trainer: TrainerRow, row: PokemonRow, now: string): Promise<number> {
  const pending = await db.query.event.findMany({
    where: and(eq(schema.event.pokemonId, row.id), eq(schema.event.rolledUp, false), lte(schema.event.ts, now)),
    orderBy: (e, { asc }) => [asc(e.ts), asc(e.id)],
  });
  const today = localDay(trainer.timezone, now);
  const finished = byLocalDay(pending, trainer.timezone).filter((events) => localDay(trainer.timezone, new Date(events[0].ts).toISOString()) !== today);
  let rolled = 0;
  let current = row;
  for (const events of finished) {
    rolled += events.length;
    await rollUpMemories({ db, trainer, row: current, events, now });
    await db
      .update(schema.event)
      .set({ rolledUp: true })
      .where(inArray(schema.event.id, events.map((e) => e.id)));
    // The next day folds into the memories this one just wrote.
    current = (await db.query.pokemon.findFirst({ where: eq(schema.pokemon.id, row.id) })) ?? current;
  }
  return rolled;
}

export async function rollover(db: Db, now = new Date().toISOString()): Promise<RolloverResult> {
  const trainers = await db.query.trainer.findMany();
  const result: RolloverResult = { at: now, trainers: trainers.length, stipends: [], settled: 0, eventsRolledUp: 0, tradesExpired: 0 };

  for (const trainer of trainers) {
    const owned = await listOwned(db, trainer.id);
    for (const row of partyOf(owned)) {
      await settle(db, trainer, row.id, now);
      result.settled += 1;
    }
    const stipend = await grantStipend(db, trainer, now);
    result.stipends.push({ trainerId: trainer.id, ...stipend });

    for (const row of owned) result.eventsRolledUp += await rollUpPending(db, trainer, row, now);
  }

  const expired = await db
    .update(schema.trade)
    .set({ state: "expired" })
    .where(and(eq(schema.trade.state, "offered"), lte(schema.trade.expiresAt, now)))
    .returning({ nonce: schema.trade.nonce });
  result.tradesExpired = expired.length;

  return result;
}

export interface RebuildResult {
  at: string;
  pokemon: Array<{ id: string; eventsRolledUp: number }>;
}

/**
 * Forgets and relives: drops the diary pages and the rolled-up memories,
 * then rolls every logged day up again in order. The bond starts over from
 * the newcomer's and moves by each day's delta, so it lands near where the
 * nights would have left it. For the owner, after a prompt change.
 */
export async function rebuildMemories(db: Db, pokemonId?: string, now = new Date().toISOString()): Promise<RebuildResult> {
  const result: RebuildResult = { at: now, pokemon: [] };
  const trainers = await db.query.trainer.findMany();
  for (const trainer of trainers) {
    for (const row of await listOwned(db, trainer.id)) {
      if (pokemonId && row.id !== pokemonId) continue;
      await db.delete(schema.event).where(and(eq(schema.event.pokemonId, row.id), like(schema.event.summary, `${JOURNAL_PREFIX}%`)));
      await db.update(schema.event).set({ rolledUp: false }).where(eq(schema.event.pokemonId, row.id));
      const memories = { summary: "", episodic: [], relationships: {} };
      await db.update(schema.pokemon).set({ memories, updatedAt: now }).where(eq(schema.pokemon.id, row.id));
      const eventsRolledUp = await rollUpPending(db, trainer, { ...row, memories }, now);
      result.pokemon.push({ id: row.id, eventsRolledUp });
    }
  }
  return result;
}
