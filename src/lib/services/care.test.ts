import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { schema } from "@/lib/db";
import { createTestDb, type TestDb } from "@/lib/db/testing";
import { CARE, CARE_EXPERIENCE, HOUR, milestoneBonus, NEED_MAX, RECOVERY_LOW, storeItem } from "@/lib/sim";
import { care, settle } from "./care";
import { purchase } from "./store";
import { giveBytes, insertPokemon, later, makeTrainer, T0 } from "./testing";
import { exportPokemon } from "./transfer";

let t: TestDb;
beforeEach(async () => {
  t ??= await createTestDb("care");
  await t.truncate();
});
afterAll(() => t?.cleanup());

async function reload(id: string) {
  return (await t.db.query.pokemon.findFirst({ where: eq(schema.pokemon.id, id) }))!;
}

describe("care", () => {
  it("decays first, then applies the action, and persists state with the events", async () => {
    const trainer = await makeTrainer(t.db, "eli", "Eli");
    const row = await insertPokemon(t.db, trainer, { slot: 1, active: true, nickname: "Vee" });
    const now = later(T0, 2 * HOUR);
    const outcome = await care(t.db, trainer, row.id, { action: "pet" }, now);
    expect(outcome.refused).toBe(false);
    expect(outcome.experience).toBe(CARE_EXPERIENCE.pet);
    expect(outcome.view.state.lastTickAt).toBe(now);
    // Two hours of decay happened before the pet; hunger fell.
    expect(outcome.view.needs.hunger).toBeLessThan(NEED_MAX);

    const saved = await reload(row.id);
    expect(saved.state).toEqual(outcome.view.state);
    expect(saved.stats.experience).toBe(CARE_EXPERIENCE.pet);
    expect(saved.stats.friendship).toBeGreaterThan(row.stats.friendship);
    const events = await t.db.query.event.findMany({ where: eq(schema.event.pokemonId, row.id) });
    expect(events.some((e) => e.kind === "care" && e.summary === "Eli petted Vee")).toBe(true);
  });

  it("writes the ledger and the state in one transaction when a milestone pays", async () => {
    const trainer = await giveBytes(t.db, await makeTrainer(t.db, "eli"), 100);
    const row = await insertPokemon(t.db, trainer, { slot: 1, active: true });
    await t.db
      .update(schema.pokemon)
      .set({ state: { ...row.state, needs: { ...row.state.needs, hygiene: RECOVERY_LOW - 5 } } })
      .where(eq(schema.pokemon.id, row.id));
    const outcome = await care(t.db, trainer, row.id, { action: "groom" }, T0);
    expect(outcome.bytes).toBe(milestoneBonus("recovery"));
    expect(outcome.balance).toBe(100 + milestoneBonus("recovery"));
    expect(outcome.view.needs.hygiene).toBe(NEED_MAX);

    const ledger = await t.db.query.ledger.findMany({ where: eq(schema.ledger.trainerId, trainer.id) });
    expect(ledger.map((l) => [l.delta, l.reason])).toEqual([[milestoneBonus("recovery"), "milestone"]]);
    const saved = await t.db.query.trainer.findFirst({ where: eq(schema.trainer.id, trainer.id) });
    expect(saved?.bytes).toBe(100 + milestoneBonus("recovery"));
    expect((await reload(row.id)).state.needs.hygiene).toBe(NEED_MAX);
  });

  it("feeds from the bag and consumes the item; refuses without one", async () => {
    const trainer = await giveBytes(t.db, await makeTrainer(t.db, "eli"), 500);
    const row = await insertPokemon(t.db, trainer, { slot: 1, active: true });
    await expect(care(t.db, trainer, row.id, { action: "feed" }, T0)).rejects.toMatchObject({ code: "item_required" });
    await expect(care(t.db, trainer, row.id, { action: "feed", item: "oran_berry" }, T0)).rejects.toMatchObject({ code: "item_not_in_bag" });

    await purchase(t.db, trainer.id, "oran_berry", 1);
    const now = later(T0, 6 * HOUR);
    const outcome = await care(t.db, trainer, row.id, { action: "feed", item: "oran_berry" }, now);
    expect(outcome.refused).toBe(false);
    const bag = await t.db.query.bag.findFirst({ where: eq(schema.bag.trainerId, trainer.id) });
    expect(bag?.qty).toBe(0);
    await expect(care(t.db, trainer, row.id, { action: "feed", item: "oran_berry" }, now)).rejects.toMatchObject({ code: "item_not_in_bag" });
  });

  it("keeps a toy's modifier and passes it into later decay", async () => {
    const trainer = await giveBytes(t.db, await makeTrainer(t.db, "eli"), 500);
    const row = await insertPokemon(t.db, trainer, { slot: 1, active: true });
    await purchase(t.db, trainer.id, "ball_toy", 1);
    const outcome = await care(t.db, trainer, row.id, { action: "play", item: "ball_toy" }, T0);
    const toy = storeItem("ball_toy")!;
    expect(outcome.view.modifiers).toEqual([{ need: "fun", factor: toy.effects.modifier!.factor, until: later(T0, toy.effects.modifier!.duration), source: "ball_toy" }]);
    expect((await reload(row.id)).modifiers).toHaveLength(1);

    // With the toy, fun decays more slowly than for an untouched twin.
    const twin = await insertPokemon(t.db, trainer, { slot: 2 });
    await t.db.update(schema.pokemon).set({ state: outcome.view.state }).where(eq(schema.pokemon.id, twin.id));
    const now = later(T0, 4 * HOUR);
    const withToy = await settle(t.db, trainer, row.id, now);
    const without = await settle(t.db, trainer, twin.id, now);
    expect(withToy.needs.fun).toBeGreaterThan(without.needs.fun);
  });

  it("does not consume the item or pay when the pokemon refuses", async () => {
    const trainer = await giveBytes(t.db, await makeTrainer(t.db, "eli"), 500);
    const row = await insertPokemon(t.db, trainer, { slot: 1, active: true });
    await t.db.update(schema.pokemon).set({ state: { ...row.state, asleep: true, sleepStartedAt: T0, needs: { ...row.state.needs, energy: 10 } } }).where(eq(schema.pokemon.id, row.id));
    await purchase(t.db, trainer.id, "oran_berry", 1);
    const outcome = await care(t.db, trainer, row.id, { action: "feed", item: "oran_berry" }, T0);
    expect(outcome.refused).toBe(true);
    expect(outcome.experience).toBe(0);
    const bag = await t.db.query.bag.findFirst({ where: eq(schema.bag.trainerId, trainer.id) });
    expect(bag?.qty).toBe(1);
    expect((await reload(row.id)).stats.experience).toBe(0);
  });

  it("refuses care on a pokemon in the PC", async () => {
    const trainer = await makeTrainer(t.db, "eli");
    const boxed = await insertPokemon(t.db, trainer, { status: "pc", slot: null, box: 1, boxSlot: 1 });
    await expect(care(t.db, trainer, boxed.id, { action: "pet" }, T0)).rejects.toMatchObject({ code: "not_home" });
  });

  it("trade lock: refuses care on an in_transit pokemon", async () => {
    const trainer = await makeTrainer(t.db, "eli");
    const row = await insertPokemon(t.db, trainer, { slot: 1, active: true });
    await exportPokemon(t.db, trainer, row.id, "trade", T0, { knownKeys: {}, installId: "test" });
    await expect(care(t.db, trainer, row.id, { action: "pet" }, T0)).rejects.toMatchObject({ code: "in_transit" });
    await expect(exportPokemon(t.db, trainer, row.id, "backup", T0, { knownKeys: {}, installId: "test" })).rejects.toMatchObject({ code: "in_transit" });
  });

  it("refuses to put a rested pokemon to bed, per the engine", async () => {
    const trainer = await makeTrainer(t.db, "eli");
    const row = await insertPokemon(t.db, trainer, { slot: 1, active: true });
    const outcome = await care(t.db, trainer, row.id, { action: "rest" }, T0);
    expect(row.state.needs.energy).toBeGreaterThanOrEqual(CARE.rest.refuseEnergy);
    expect(outcome.refused).toBe(true);
  });
});
