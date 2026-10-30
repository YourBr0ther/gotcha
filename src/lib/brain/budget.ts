/**
 * Daily caps per pokemon, kept in brain_usage. withBudget wraps one model
 * call: it refuses when the key is missing or the day's cap is spent,
 * counts the call before it runs so parallel ticks cannot overspend, gives
 * the call BRAIN_TIMEOUT_MS, and adds the tokens afterwards. Every refusal
 * and failure comes back as `{ source: "rules" }` with a reason, and the
 * caller picks by rules instead.
 */

import { and, eq, sql } from "drizzle-orm";
import { schema, type DbOrTx } from "@/lib/db";
import type { BrainUsageRow } from "@/lib/db/schema";
import { BRAIN_TIMEOUT_MS, TALK_CALLS_PER_DAY, TICK_CALLS_PER_DAY, TOKENS_PER_DAY } from "./constants";
import { isConfigured } from "./provider";

export type BudgetKind = "tick" | "talk";

export type FallbackReason = "unconfigured" | "cap" | "timeout" | "error" | "rejected";

export type BudgetOutcome<T> =
  | { source: "model"; value: T; tokens: number }
  | { source: "rules"; reason: FallbackReason; error?: unknown };

export interface BudgetCaps {
  tickCalls: number;
  talkCalls: number;
  tokens: number;
}

export const DEFAULT_CAPS: BudgetCaps = {
  tickCalls: TICK_CALLS_PER_DAY,
  talkCalls: TALK_CALLS_PER_DAY,
  tokens: TOKENS_PER_DAY,
};

export interface BudgetOptions {
  now?: string;
  timeoutMs?: number;
  caps?: Partial<BudgetCaps>;
  /** Overrides the env check; tests use it to pretend a key exists. */
  configured?: boolean;
}

/** The call returns its value and how many tokens it spent. It should honour the signal. */
export type BudgetedCall<T> = (signal: AbortSignal) => Promise<{ value: T; tokens: number }>;

/** Usage days are UTC dates; the caps are generous enough that the boundary does not matter. */
export function usageDay(now: string): string {
  return now.slice(0, 10);
}

export async function usageFor(db: DbOrTx, pokemonId: string, day: string): Promise<BrainUsageRow> {
  const row = await db.query.brainUsage.findFirst({ where: and(eq(schema.brainUsage.pokemonId, pokemonId), eq(schema.brainUsage.day, day)) });
  return row ?? { pokemonId, day, tickCalls: 0, talkCalls: 0, tokens: 0 };
}

export class BudgetTimeout extends Error {
  constructor(ms: number) {
    super(`model call exceeded ${ms} ms`);
    this.name = "BudgetTimeout";
  }
}

/**
 * Reserves one call for today if the caps allow it. One insert that does
 * nothing on conflict, then a guarded increment; the update returning no
 * row means the cap is spent.
 */
async function reserve(db: DbOrTx, pokemonId: string, day: string, kind: BudgetKind, caps: BudgetCaps): Promise<boolean> {
  await db.insert(schema.brainUsage).values({ pokemonId, day }).onConflictDoNothing();
  const column = kind === "tick" ? schema.brainUsage.tickCalls : schema.brainUsage.talkCalls;
  const cap = kind === "tick" ? caps.tickCalls : caps.talkCalls;
  const updated = await db
    .update(schema.brainUsage)
    .set(kind === "tick" ? { tickCalls: sql`${column} + 1` } : { talkCalls: sql`${column} + 1` })
    .where(and(eq(schema.brainUsage.pokemonId, pokemonId), eq(schema.brainUsage.day, day), sql`${column} < ${cap}`, sql`${schema.brainUsage.tokens} < ${caps.tokens}`))
    .returning({ pokemonId: schema.brainUsage.pokemonId });
  return updated.length > 0;
}

export async function withBudget<T>(db: DbOrTx, pokemonId: string, kind: BudgetKind, fn: BudgetedCall<T>, options: BudgetOptions = {}): Promise<BudgetOutcome<T>> {
  const configured = options.configured ?? isConfigured();
  if (!configured) return { source: "rules", reason: "unconfigured" };

  const now = options.now ?? new Date().toISOString();
  const caps = { ...DEFAULT_CAPS, ...options.caps };
  const day = usageDay(now);
  if (!(await reserve(db, pokemonId, day, kind, caps))) return { source: "rules", reason: "cap" };

  const timeoutMs = options.timeoutMs ?? BRAIN_TIMEOUT_MS;
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      reject(new BudgetTimeout(timeoutMs));
    }, timeoutMs);
  });

  try {
    const result = await Promise.race([fn(controller.signal), timeout]);
    const tokens = Number.isFinite(result.tokens) ? Math.max(0, Math.round(result.tokens)) : 0;
    if (tokens > 0) {
      await db
        .update(schema.brainUsage)
        .set({ tokens: sql`${schema.brainUsage.tokens} + ${tokens}` })
        .where(and(eq(schema.brainUsage.pokemonId, pokemonId), eq(schema.brainUsage.day, day)));
    }
    return { source: "model", value: result.value, tokens };
  } catch (error) {
    // A call that honours the signal rejects on abort before the timer's own rejection lands, so the signal is the truth.
    if (error instanceof BudgetTimeout || controller.signal.aborted) return { source: "rules", reason: "timeout", error };
    return { source: "rules", reason: "error", error };
  } finally {
    if (timer) clearTimeout(timer);
  }
}
