/**
 * The nightly roll-over, hit by a CronJob through /api/internal/rollover.
 * Per trainer: settle the party so the day's engine events are logged, pay
 * the stipend, hand the unrolled events to the memory roll-up hook, then
 * mark them rolled_up. Also expires trade offers past their expiry.
 */

import { and, eq, inArray, lte } from "drizzle-orm";
import { schema, type Db } from "@/lib/db";
import { rollUpMemories } from "./brain-hook";
import { settle } from "./care";
import { grantStipend } from "./economy";
import { listOwned, partyOf } from "./pokemon";

export interface RolloverResult {
  at: string;
  trainers: number;
  stipends: Array<{ trainerId: string; day: string; bytes: number; paid: boolean }>;
  settled: number;
  eventsRolledUp: number;
  tradesExpired: number;
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

    for (const row of owned) {
      const pending = await db.query.event.findMany({
        where: and(eq(schema.event.pokemonId, row.id), eq(schema.event.rolledUp, false), lte(schema.event.ts, now)),
        orderBy: (e, { asc }) => [asc(e.ts), asc(e.id)],
      });
      if (pending.length === 0) continue;
      await rollUpMemories({ db, trainer, row, events: pending, now });
      await db
        .update(schema.event)
        .set({ rolledUp: true })
        .where(inArray(schema.event.id, pending.map((e) => e.id)));
      result.eventsRolledUp += pending.length;
    }
  }

  const expired = await db
    .update(schema.trade)
    .set({ state: "expired" })
    .where(and(eq(schema.trade.state, "offered"), lte(schema.trade.expiresAt, now)))
    .returning({ nonce: schema.trade.nonce });
  result.tradesExpired = expired.length;

  return result;
}
