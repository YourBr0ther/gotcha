/**
 * The journal: the pokemon's rolled-up memories plus the dated "Journal,"
 * rows the nightly roll-up writes. Served by its own route rather than the
 * view, which rides the five-second stream and should stay small.
 */

import { and, desc, eq, like } from "drizzle-orm";
import type { EpisodicEvent, Relationship } from "@gotcha/cpkmn";
import { schema, type DbOrTx } from "@/lib/db";
import { getPokemon } from "./pokemon";

export const EPISODIC_LIMIT = 100;
export const JOURNAL_ENTRY_LIMIT = 60;
export const JOURNAL_PREFIX = "Journal,";

export interface JournalEntry {
  id: number;
  ts: string;
  summary: string;
  emotion: string | null;
}

export interface JournalView {
  pokemonId: string;
  summary: string;
  relationships: Record<string, Relationship>;
  /** Newest first, at most EPISODIC_LIMIT. */
  episodic: EpisodicEvent[];
  /** Nightly roll-up rows, newest first. */
  journalEntries: JournalEntry[];
  /** The newest timestamp across episodic memories and journal rows; null when both are empty. */
  newestAt: string | null;
}

function newestOf(times: Iterable<string>): string | null {
  let newest: string | null = null;
  for (const t of times) if (newest === null || t > newest) newest = t;
  return newest;
}

export async function getJournal(db: DbOrTx, trainerId: string, pokemonId: string): Promise<JournalView> {
  const row = await getPokemon(db, trainerId, pokemonId);
  const episodic = [...row.memories.episodic].sort((a, b) => (a.ts === b.ts ? 0 : a.ts < b.ts ? 1 : -1)).slice(0, EPISODIC_LIMIT);
  const rows = await db.query.event.findMany({
    where: and(eq(schema.event.pokemonId, row.id), like(schema.event.summary, `${JOURNAL_PREFIX}%`)),
    orderBy: [desc(schema.event.ts), desc(schema.event.id)],
    limit: JOURNAL_ENTRY_LIMIT,
  });
  // Postgres returns "2026-11-02 21:00:00+00"; the file's memories are ISO, and the badge compares the two as strings.
  const journalEntries = rows.map((e) => ({ id: e.id, ts: new Date(e.ts).toISOString(), summary: e.summary, emotion: e.emotion }));
  return {
    pokemonId: row.id,
    summary: row.memories.summary,
    relationships: row.memories.relationships,
    episodic,
    journalEntries,
    newestAt: newestOf([...episodic.map((e) => e.ts), ...journalEntries.map((e) => e.ts)]),
  };
}
