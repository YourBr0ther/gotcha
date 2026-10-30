/**
 * Event rows in and out of the episodic shape, plus the two small state
 * writes the brain is allowed: the misbehaving flag and the current
 * activity. Both go through a jsonb merge so a concurrent care write to
 * the same row is not clobbered.
 */

import { desc, eq, sql } from "drizzle-orm";
import type { EpisodicEvent, EventKind } from "@gotcha/cpkmn";
import { schema, type DbOrTx } from "@/lib/db";
import type { EventRow, NewEventRow } from "@/lib/db/schema";
import { RECENT_EVENTS } from "./constants";
import type { Emote } from "./types";

export function toEpisodic(row: EventRow): EpisodicEvent {
  const importance = Math.min(5, Math.max(1, Math.round(row.importance))) as EpisodicEvent["importance"];
  return {
    ts: new Date(row.ts).toISOString(),
    kind: row.kind as EventKind,
    summary: row.summary.slice(0, 280),
    importance,
    ...(row.trainerId ? { trainerId: row.trainerId } : {}),
    ...(row.emotion ? { emotion: row.emotion } : {}),
  };
}

/** The newest events first out of the database, oldest first on return. */
export async function recentEvents(db: DbOrTx, pokemonId: string, limit = RECENT_EVENTS): Promise<EpisodicEvent[]> {
  const rows = await db.query.event.findMany({
    where: eq(schema.event.pokemonId, pokemonId),
    orderBy: [desc(schema.event.ts), desc(schema.event.id)],
    limit,
  });
  return rows.reverse().map(toEpisodic);
}

/** How an emote reads as a feeling in the log. */
export const EMOTE_EMOTION: Readonly<Record<Emote, string>> = {
  happy: "happy",
  love: "affectionate",
  sad: "sad",
  angry: "cross",
  question: "curious",
  surprise: "startled",
  sleepy: "drowsy",
  music: "cheerful",
};

export async function insertEvent(db: DbOrTx, row: NewEventRow): Promise<EventRow> {
  const [inserted] = await db.insert(schema.event).values(row).returning();
  return inserted;
}

/** Sets state.flags.misbehaving without touching the rest of the state. */
export async function setMisbehaving(db: DbOrTx, pokemonId: string, value: boolean, now: string): Promise<void> {
  const flag = value ? sql`'{"misbehaving": true}'::jsonb` : sql`'{"misbehaving": false}'::jsonb`;
  await db
    .update(schema.pokemon)
    .set({
      state: sql`${schema.pokemon.state} || jsonb_build_object('flags', coalesce(${schema.pokemon.state}->'flags', '{}'::jsonb) || ${flag})`,
      updatedAt: now,
    })
    .where(eq(schema.pokemon.id, pokemonId));
}

/** Records the chosen activity on the state so the Neighborhood summary matches the scene. */
export async function setActivity(db: DbOrTx, pokemonId: string, activity: string, now: string): Promise<void> {
  await db
    .update(schema.pokemon)
    .set({ state: sql`${schema.pokemon.state} || jsonb_build_object('activity', ${activity}::text)`, updatedAt: now })
    .where(eq(schema.pokemon.id, pokemonId));
}
