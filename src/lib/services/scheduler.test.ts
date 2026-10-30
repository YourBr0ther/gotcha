import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { createTestDb, type TestDb } from "@/lib/db/testing";
import { subscribe } from "./bus";
import { dueForTick, markTicked, resetScheduler, runDueTicks, UNWATCHED_TICK_INTERVAL, WATCHED_TICK_INTERVAL } from "./scheduler";
import { insertPokemon, later, makeTrainer, T0 } from "./testing";

let t: TestDb;
beforeEach(async () => {
  t ??= await createTestDb("scheduler");
  await t.truncate();
  resetScheduler();
});
afterAll(() => t?.cleanup());

describe("scheduler", () => {
  it("ticks active pokemon only, watched every few minutes and unwatched hourly", async () => {
    const trainer = await makeTrainer(t.db, "eli");
    const active = await insertPokemon(t.db, trainer, { slot: 1, active: true });
    await insertPokemon(t.db, trainer, { slot: 2 });
    await insertPokemon(t.db, trainer, { status: "pc", slot: null, box: 1, boxSlot: 1 });

    // Everything active is due on a fresh process.
    expect((await dueForTick(t.db, T0)).map((d) => d.pokemonId)).toEqual([active.id]);
    markTicked(active.id, T0);
    expect(await dueForTick(t.db, later(T0, WATCHED_TICK_INTERVAL))).toEqual([]);
    expect((await dueForTick(t.db, later(T0, UNWATCHED_TICK_INTERVAL))).map((d) => d.watched)).toEqual([false]);

    const off = subscribe(active.id, () => {});
    try {
      const due = await dueForTick(t.db, later(T0, WATCHED_TICK_INTERVAL));
      expect(due).toMatchObject([{ pokemonId: active.id, watched: true, lastTickAt: T0 }]);
    } finally {
      off();
    }
  });

  it("runDueTicks settles the pokemon and records the tick", async () => {
    const trainer = await makeTrainer(t.db, "eli");
    const active = await insertPokemon(t.db, trainer, { slot: 1, active: true });
    const messages: unknown[] = [];
    const off = subscribe(active.id, (m) => messages.push(m));
    try {
      const now = later(T0, 3600_000);
      const ran = await runDueTicks(t.db, now);
      expect(ran.map((d) => d.pokemonId)).toEqual([active.id]);
      expect(await dueForTick(t.db, now)).toEqual([]);
      // The settle publishes a state view, then the brain hook's plan follows
      // (rules-only here, since no model is configured).
      expect(messages[0]).toMatchObject({ type: "state", cause: "settle" });
      expect(messages.some((m) => (m as { type?: string }).type === "brain")).toBe(true);
      const row = await t.db.query.pokemon.findFirst();
      expect(row?.state.lastTickAt).toBe(now);
    } finally {
      off();
    }
  });
});
