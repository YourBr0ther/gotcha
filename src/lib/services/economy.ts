/**
 * Bytes income that is not a care milestone or a mini-game: the daily care
 * stipend. Paid once per trainer per local day, enforced by the ledger's
 * partial unique index as well as the check here.
 */

import { and, eq } from "drizzle-orm";
import type { Needs } from "@gotcha/cpkmn";
import { dailyStipend } from "@/lib/sim";
import { schema, type Db } from "@/lib/db";
import type { TrainerRow } from "@/lib/db/schema";
import { listOwned, partyOf } from "./pokemon";
import { adjustBytes } from "./trainers";
import { decayedState, localDay } from "./views";

export interface StipendResult {
  day: string;
  bytes: number;
  /** False when today's stipend had already been paid. */
  paid: boolean;
}

/**
 * The engine scores needs sampled across the day. Until a sampler exists,
 * the sample is one reading per party pokemon at roll-up time, so a trainer
 * whose party is fed and clean at night gets paid.
 */
export async function stipendSamples(db: Db, trainer: TrainerRow, now: string): Promise<Needs[]> {
  const party = partyOf(await listOwned(db, trainer.id));
  const samples: Needs[] = [];
  for (const row of party) samples.push((await decayedState(row, now)).state.needs);
  return samples;
}

export async function grantStipend(db: Db, trainer: TrainerRow, now = new Date().toISOString()): Promise<StipendResult> {
  const day = localDay(trainer.timezone, now);
  const already = await db.query.ledger.findFirst({
    where: and(eq(schema.ledger.trainerId, trainer.id), eq(schema.ledger.reason, "stipend"), eq(schema.ledger.ref, day)),
  });
  if (already) return { day, bytes: already.delta, paid: false };

  const bytes = dailyStipend(await stipendSamples(db, trainer, now));
  await db.transaction(async (tx) => {
    if (bytes > 0) await adjustBytes(tx, trainer.id, bytes, "stipend", day);
    // A zero stipend still leaves a row so the day counts as paid.
    else await tx.insert(schema.ledger).values({ trainerId: trainer.id, delta: 0, reason: "stipend", ref: day, at: now });
  });
  return { day, bytes, paid: true };
}
