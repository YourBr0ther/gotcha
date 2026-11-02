/**
 * The journal: one section per local day, newest first, each with the
 * diary page the nightly roll-up wrote and the moments worth a line. The
 * hourly chatter and the body-clock rows (fell asleep, woke up, made a
 * mess) stay out; they are what made the first journal unreadable. Today
 * is live from the event log, so the trainer sees the day fill in before
 * the page gets written. Served by its own route rather than the view,
 * which rides the five-second stream and should stay small.
 */

import { and, desc, eq, like } from "drizzle-orm";
import type { EpisodicEvent, EventKind, Relationship } from "@gotcha/cpkmn";
import { JOURNAL_PREFIX } from "@/lib/brain/rollup";
import { schema, type DbOrTx } from "@/lib/db";
import { ServiceError } from "./errors";
import { getPokemon } from "./pokemon";
import { localDay } from "./views";

/** Days the journal goes back. */
export const JOURNAL_DAYS = 30;
/** Lines a day gets at most; the ones that mattered come first, then the earliest. */
export const MOMENTS_PER_DAY = 10;
export { JOURNAL_PREFIX };

export interface JournalMoment {
  ts: string;
  kind: EventKind;
  summary: string;
  emotion: string | null;
  importance: number;
  /** The same thing happened this many times that day. */
  times: number;
}

export interface JournalDay {
  /** Local day, YYYY-MM-DD, in the trainer's timezone. */
  day: string;
  /** The diary page the roll-up wrote, or null before it has. */
  page: string | null;
  /** When the page was written. */
  pageAt: string | null;
  /** The pokemon's word for how the day felt. */
  feeling: string | null;
  /** Oldest first. */
  moments: JournalMoment[];
}

export interface JournalView {
  pokemonId: string;
  /** The memory the pokemon carries forward, in its own words. */
  summary: string;
  relationships: Record<string, Relationship>;
  /** Today's local day, so the client can label it without guessing the timezone. */
  today: string;
  /** Newest first, at most JOURNAL_DAYS, only days with something in them. */
  days: JournalDay[];
  /** When the newest page was written; null before the first roll-up. The badge compares it to what the browser last saw. */
  newestAt: string | null;
}

const PAGE_RE = new RegExp(`^${JOURNAL_PREFIX}\\s*(\\d{4}-\\d{2}-\\d{2}):\\s*`);

/** Splits "Journal, 2026-11-02: text" into its day and text; null for any other row. */
export function parsePage(summary: string): { day: string; text: string } | null {
  const m = PAGE_RE.exec(summary);
  return m ? { day: m[1], text: summary.slice(m[0].length).trim() } : null;
}

/** An idle line the pokemon said to nobody: `Name said "..."` and nothing after it. A conversation row carries the answer too. */
export function isChatter(summary: string): boolean {
  return / said "[^"]*"$/.test(summary) && !/ answered "/.test(summary);
}

/** Whether a memory earns a line on the page: anything that mattered, or anything the trainer did, minus the chatter, the body clock and the taps it slept through. */
export function worthALine(e: Pick<EpisodicEvent, "kind" | "importance" | "summary">): boolean {
  if (parsePage(e.summary) || isChatter(e.summary) || / refused \(/.test(e.summary)) return false;
  if (e.importance >= 2) return true;
  return e.kind === "care" || e.kind === "play" || e.kind === "talk";
}

/** One line per distinct thing that happened that day, at the time it first did, with a count; then the cap. */
function collapse(events: readonly EpisodicEvent[], cap = MOMENTS_PER_DAY): JournalMoment[] {
  const byText = new Map<string, JournalMoment>();
  for (const e of events) {
    const seen = byText.get(e.summary);
    if (seen) seen.times += 1;
    else byText.set(e.summary, { ts: e.ts, kind: e.kind, summary: e.summary, emotion: e.emotion ?? null, importance: e.importance, times: 1 });
  }
  const kept = [...byText.values()].sort((a, b) => b.importance - a.importance || a.ts.localeCompare(b.ts)).slice(0, cap);
  return kept.sort((a, b) => a.ts.localeCompare(b.ts));
}

export async function getJournal(db: DbOrTx, trainerId: string, pokemonId: string, now = new Date().toISOString()): Promise<JournalView> {
  const row = await getPokemon(db, trainerId, pokemonId);
  const trainer = await db.query.trainer.findFirst({ where: eq(schema.trainer.id, trainerId) });
  if (!trainer) throw new ServiceError("not_found", "trainer not found");
  const tz = trainer.timezone;

  const pages = await db.query.event.findMany({
    where: and(eq(schema.event.pokemonId, row.id), like(schema.event.summary, `${JOURNAL_PREFIX}%`)),
    orderBy: [desc(schema.event.ts), desc(schema.event.id)],
    limit: JOURNAL_DAYS,
  });
  const pending = await db.query.event.findMany({
    where: and(eq(schema.event.pokemonId, row.id), eq(schema.event.rolledUp, false)),
    orderBy: (e, { asc }) => [asc(e.ts), asc(e.id)],
  });

  const days = new Map<string, JournalDay>();
  const dayFor = (day: string): JournalDay => {
    let d = days.get(day);
    if (!d) {
      d = { day, page: null, pageAt: null, feeling: null, moments: [] };
      days.set(day, d);
    }
    return d;
  };
  for (const p of pages) {
    const parsed = parsePage(p.summary);
    if (!parsed) continue;
    const d = dayFor(parsed.day);
    // Newest first, so the first page seen for a day wins over a stale duplicate.
    if (d.page === null) Object.assign(d, { page: parsed.text, pageAt: new Date(p.ts).toISOString(), feeling: p.emotion });
  }
  const remembered: EpisodicEvent[] = [
    ...row.memories.episodic,
    ...pending.map((e) => ({ ts: new Date(e.ts).toISOString(), kind: e.kind as EventKind, summary: e.summary, importance: Math.min(5, Math.max(1, e.importance)) as EpisodicEvent["importance"], ...(e.emotion ? { emotion: e.emotion } : {}) })),
  ]
    .filter(worthALine)
    .sort((a, b) => a.ts.localeCompare(b.ts));
  const byDay = new Map<string, EpisodicEvent[]>();
  for (const e of remembered) {
    const day = localDay(tz, e.ts);
    const list = byDay.get(day);
    if (list) list.push(e);
    else byDay.set(day, [e]);
  }
  for (const [day, list] of byDay) dayFor(day).moments = collapse(list);

  const ordered = [...days.values()].sort((a, b) => b.day.localeCompare(a.day)).slice(0, JOURNAL_DAYS);
  // Postgres returns "2026-11-02 21:00:00+00"; the badge compares ISO strings, so the newest page goes out as ISO.
  const newestAt = pages.length > 0 ? new Date(pages[0].ts).toISOString() : null;
  return { pokemonId: row.id, summary: row.memories.summary, relationships: row.memories.relationships, today: localDay(tz, now), days: ordered, newestAt };
}
