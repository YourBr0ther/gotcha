import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { schema } from "@/lib/db";
import { createTestDb, type TestDb } from "@/lib/db/testing";
import { DAY, STIPEND_FULL_CARE_BONUS, STIPEND_MAX } from "@/lib/sim";
import { grantStipend } from "./economy";
import { rollover } from "./rollover";
import { insertPokemon, later, makeTrainer, T0 } from "./testing";
import { setTimezone } from "./trainers";

let t: TestDb;
beforeEach(async () => {
  t ??= await createTestDb("economy");
  await t.truncate();
});
afterAll(() => t?.cleanup());

describe("stipend", () => {
  it("pays once per local day and the full-care bonus for a fresh party", async () => {
    const trainer = await makeTrainer(t.db, "eli");
    await insertPokemon(t.db, trainer, { slot: 1, active: true, now: T0 });
    const first = await grantStipend(t.db, trainer, T0);
    expect(first).toEqual({ day: "2026-11-02", bytes: STIPEND_MAX + STIPEND_FULL_CARE_BONUS, paid: true });

    const again = await grantStipend(t.db, trainer, later(T0, 3600_000));
    expect(again.paid).toBe(false);
    const ledger = await t.db.query.ledger.findMany({ where: eq(schema.ledger.trainerId, trainer.id) });
    expect(ledger).toHaveLength(1);
    expect(ledger[0]).toMatchObject({ reason: "stipend", ref: "2026-11-02", delta: first.bytes });

    const tomorrow = await grantStipend(t.db, trainer, later(T0, DAY));
    expect(tomorrow.paid).toBe(true);
    expect(tomorrow.day).toBe("2026-11-03");
  });

  it("uses the trainer's timezone for the day boundary", async () => {
    const trainer = await setTimezone(t.db, (await makeTrainer(t.db, "eli")).id, "Pacific/Auckland");
    await insertPokemon(t.db, trainer, { slot: 1, active: true, now: T0 });
    // 20:00Z on the 2nd is already the 3rd in Auckland.
    expect((await grantStipend(t.db, trainer, T0)).day).toBe("2026-11-03");
  });

  it("pays nothing without a party but still counts the day", async () => {
    const trainer = await makeTrainer(t.db, "eli");
    expect(await grantStipend(t.db, trainer, T0)).toEqual({ day: "2026-11-02", bytes: 0, paid: true });
    expect((await grantStipend(t.db, trainer, T0)).paid).toBe(false);
  });

  it("rollover pays every trainer once and marks events rolled up", async () => {
    const eli = await makeTrainer(t.db, "eli");
    const mae = await makeTrainer(t.db, "mae");
    const row = await insertPokemon(t.db, eli, { slot: 1, active: true, now: T0 });
    await insertPokemon(t.db, mae, { slot: 1, active: true, now: T0 });
    await t.db.insert(schema.event).values({ pokemonId: row.id, ts: T0, kind: "care", summary: "something happened", importance: 1 });

    const now = later(T0, 6 * 3600_000);
    const first = await rollover(t.db, now);
    expect(first.trainers).toBe(2);
    expect(first.stipends.every((s) => s.paid)).toBe(true);
    expect(first.eventsRolledUp).toBeGreaterThanOrEqual(1);
    const pending = await t.db.query.event.findMany({ where: eq(schema.event.rolledUp, false) });
    expect(pending).toEqual([]);

    const second = await rollover(t.db, later(now, 60_000));
    expect(second.stipends.every((s) => !s.paid)).toBe(true);
  });
});
