import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { createTestDb, type TestDb } from "@/lib/db/testing";
import { insertPokemon, makeTrainer, T0 } from "@/lib/services/testing";
import { usageDay, usageFor, withBudget } from "./budget";
import { TALK_CALLS_PER_DAY, TICK_CALLS_PER_DAY, TOKENS_PER_DAY } from "./constants";

let t: TestDb;
beforeEach(async () => {
  t ??= await createTestDb("brain_budget");
  await t.truncate();
});
afterAll(() => t?.cleanup());

async function pokemon() {
  const trainer = await makeTrainer(t.db, "eli", "Eli");
  return insertPokemon(t.db, trainer, { slot: 1, active: true });
}

describe("withBudget", () => {
  it("answers rules without a key and never calls the model", async () => {
    const row = await pokemon();
    let calls = 0;
    const out = await withBudget(t.db, row.id, "tick", async () => ({ value: ++calls, tokens: 5 }), { now: T0, configured: false });
    expect(out).toEqual({ source: "rules", reason: "unconfigured" });
    expect(calls).toBe(0);
    expect(await usageFor(t.db, row.id, usageDay(T0))).toMatchObject({ tickCalls: 0, tokens: 0 });
  });

  it("counts calls and tokens per pokemon per day and stops at the cap", async () => {
    const row = await pokemon();
    const caps = { tickCalls: 2, talkCalls: 1, tokens: TOKENS_PER_DAY };
    const first = await withBudget(t.db, row.id, "tick", async () => ({ value: "a", tokens: 30 }), { now: T0, configured: true, caps });
    expect(first).toEqual({ source: "model", value: "a", tokens: 30 });
    await withBudget(t.db, row.id, "tick", async () => ({ value: "b", tokens: 12 }), { now: T0, configured: true, caps });
    const third = await withBudget(t.db, row.id, "tick", async () => ({ value: "c", tokens: 1 }), { now: T0, configured: true, caps });
    expect(third).toEqual({ source: "rules", reason: "cap" });
    expect(await usageFor(t.db, row.id, usageDay(T0))).toMatchObject({ tickCalls: 2, talkCalls: 0, tokens: 42 });

    // Talk has its own counter, and a new day starts fresh.
    expect((await withBudget(t.db, row.id, "talk", async () => ({ value: "t", tokens: 0 }), { now: T0, configured: true, caps })).source).toBe("model");
    expect((await withBudget(t.db, row.id, "talk", async () => ({ value: "t", tokens: 0 }), { now: T0, configured: true, caps })).source).toBe("rules");
    const tomorrow = "2026-11-03T01:00:00.000Z";
    expect((await withBudget(t.db, row.id, "tick", async () => ({ value: "d", tokens: 1 }), { now: tomorrow, configured: true, caps })).source).toBe("model");
  });

  it("a token cap stops both kinds", async () => {
    const row = await pokemon();
    const caps = { tickCalls: TICK_CALLS_PER_DAY, talkCalls: TALK_CALLS_PER_DAY, tokens: 50 };
    await withBudget(t.db, row.id, "tick", async () => ({ value: 1, tokens: 60 }), { now: T0, configured: true, caps });
    expect((await withBudget(t.db, row.id, "talk", async () => ({ value: 2, tokens: 1 }), { now: T0, configured: true, caps })).source).toBe("rules");
  });

  it("times out, aborts the call, and still counts the attempt", async () => {
    const row = await pokemon();
    let aborted = false;
    const out = await withBudget(
      t.db,
      row.id,
      "tick",
      (signal) =>
        new Promise((_, reject) => {
          signal.addEventListener("abort", () => {
            aborted = true;
            reject(new Error("aborted"));
          });
        }),
      { now: T0, configured: true, timeoutMs: 20 },
    );
    expect(out).toMatchObject({ source: "rules", reason: "timeout" });
    expect(aborted).toBe(true);
    expect((await usageFor(t.db, row.id, usageDay(T0))).tickCalls).toBe(1);
  });

  it("a throwing call is an error fallback", async () => {
    const row = await pokemon();
    const out = await withBudget(
      t.db,
      row.id,
      "tick",
      async () => {
        throw new Error("boom");
      },
      { now: T0, configured: true },
    );
    expect(out).toMatchObject({ source: "rules", reason: "error" });
  });
});
