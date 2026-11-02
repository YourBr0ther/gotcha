/**
 * Trainers. Identity arrives from Authelia as a username; the first request
 * from a new username creates the row.
 */

import { and, eq, sql } from "drizzle-orm";
import { schema, type DbOrTx } from "@/lib/db";
import type { TrainerRow } from "@/lib/db/schema";
import { ServiceError } from "./errors";
import { activeSummary, type ActivePokemonSummary } from "./views";

export interface TrainerSummary {
  id: string;
  name: string;
  /** The login the proxy vouches for, shown beside the chosen name so a name alone never identifies anyone. */
  username: string;
  activePokemon: ActivePokemonSummary | null;
}

export async function upsertTrainer(db: DbOrTx, username: string, displayName?: string): Promise<TrainerRow> {
  const name = displayName?.trim() || username;
  const [row] = await db
    .insert(schema.trainer)
    .values({ username, displayName: name })
    .onConflictDoUpdate({
      target: schema.trainer.username,
      // Keep a display name the trainer already has unless the header carries a new one.
      set: displayName?.trim() ? { displayName: name } : { username: sql`excluded.username` },
    })
    .returning();
  return row;
}

export async function getTrainer(db: DbOrTx, trainerId: string): Promise<TrainerRow> {
  const row = await db.query.trainer.findFirst({ where: eq(schema.trainer.id, trainerId) });
  if (!row) throw new ServiceError("not_found", "trainer not found");
  return row;
}

/** A display name as stored: Unicode-normalised, control and direction-override characters gone, spaces squeezed, 24 characters at most. */
export function cleanDisplayName(name: string): string {
  return name
    .normalize("NFKC")
    .replace(/[\p{Cc}\p{Cf}]/gu, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 24)
    .trim();
}

/**
 * The name the pokemon use for the trainer and the neighborhood shows. A
 * name another trainer in the install already uses is refused, compared
 * case-insensitively after cleaning, so one child cannot pass as another;
 * the neighborhood shows the login beside the name as well.
 */
export async function setDisplayName(db: DbOrTx, trainerId: string, name: string): Promise<TrainerRow> {
  const clean = cleanDisplayName(name);
  if (!clean) throw new ServiceError("bad_request", "name is empty");
  const others = await db.query.trainer.findMany({ where: sql`${schema.trainer.id} <> ${trainerId}` });
  const taken = others.some((t) => cleanDisplayName(t.displayName).toLowerCase() === clean.toLowerCase() || t.username.toLowerCase() === clean.toLowerCase());
  if (taken) throw new ServiceError("name_taken", "someone in the family already goes by that name");
  const [row] = await db.update(schema.trainer).set({ displayName: clean }).where(eq(schema.trainer.id, trainerId)).returning();
  if (!row) throw new ServiceError("not_found", "trainer not found");
  return row;
}

export async function setTimezone(db: DbOrTx, trainerId: string, timezone: string): Promise<TrainerRow> {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: timezone });
  } catch {
    throw new ServiceError("bad_request", `unknown timezone "${timezone}"`);
  }
  const [row] = await db.update(schema.trainer).set({ timezone }).where(eq(schema.trainer.id, trainerId)).returning();
  if (!row) throw new ServiceError("not_found", "trainer not found");
  return row;
}

/** Everyone, with their active pokemon, for the Neighborhood. */
export async function listTrainers(db: DbOrTx, now: string): Promise<TrainerSummary[]> {
  const trainers = await db.query.trainer.findMany({ orderBy: (t, { asc }) => [asc(t.createdAt)] });
  const actives = await db.query.pokemon.findMany({
    where: and(eq(schema.pokemon.active, true), eq(schema.pokemon.status, "home")),
  });
  const byTrainer = new Map(actives.map((p) => [p.trainerId, p]));
  const out: TrainerSummary[] = [];
  for (const t of trainers) {
    const active = byTrainer.get(t.id);
    out.push({ id: t.id, name: t.displayName, username: t.username, activePokemon: active ? await activeSummary(active, t, now) : null });
  }
  return out;
}

/** Changes the balance and writes the ledger in the caller's transaction. Never lets Bytes go negative. */
export async function adjustBytes(tx: DbOrTx, trainerId: string, delta: number, reason: string, ref?: string): Promise<number> {
  if (!Number.isInteger(delta)) throw new ServiceError("bad_request", "Bytes deltas are whole numbers");
  const [row] = await tx
    .select({ bytes: schema.trainer.bytes })
    .from(schema.trainer)
    .where(eq(schema.trainer.id, trainerId))
    .for("update");
  if (!row) throw new ServiceError("not_found", "trainer not found");
  const next = row.bytes + delta;
  if (next < 0) throw new ServiceError("insufficient_bytes", `need ${-delta} Bytes, have ${row.bytes}`);
  if (delta !== 0) {
    await tx.update(schema.trainer).set({ bytes: next }).where(eq(schema.trainer.id, trainerId));
    await tx.insert(schema.ledger).values({ trainerId, delta, reason, ref: ref ?? null });
  }
  return next;
}

export async function getBag(db: DbOrTx, trainerId: string): Promise<Array<{ itemId: string; qty: number }>> {
  const rows = await db.query.bag.findMany({ where: eq(schema.bag.trainerId, trainerId), orderBy: (b, { asc }) => [asc(b.itemId)] });
  return rows.filter((r) => r.qty > 0).map((r) => ({ itemId: r.itemId, qty: r.qty }));
}
