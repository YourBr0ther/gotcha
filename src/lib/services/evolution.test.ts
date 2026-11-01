import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { schema } from "@/lib/db";
import { createTestDb, type TestDb } from "@/lib/db/testing";
import { EVOLUTION_SNOOZE, milestoneBonus, storeItem } from "@/lib/sim";
import { decline, evolve } from "./evolution";
import { purchase } from "./store";
import { giveBytes, insertPokemon, later, makeTrainer, T0 } from "./testing";
import { pokemonView } from "./views";

let t: TestDb;

beforeEach(async () => {
  t ??= await createTestDb("evolution");
  await t.truncate();
});

afterAll(() => t?.cleanup());

async function reload(id: string) {
  return (await t.db.query.pokemon.findFirst({ where: eq(schema.pokemon.id, id) }))!;
}

describe("evolve", () => {
  it("turns an Eevee into a Flareon with a fire stone, spends the stone, pays the milestone and remembers it", async () => {
    const trainer = await giveBytes(t.db, await makeTrainer(t.db, "eli", "Eli"), 1000);
    const row = await insertPokemon(t.db, trainer, { slot: 1, active: true, nickname: "Vee" });
    await expect(evolve(t.db, trainer, row.id, "flareon", T0)).rejects.toMatchObject({ code: "cannot_evolve" });
    await purchase(t.db, trainer.id, "fire_stone", 1);
    // The ask names the stone evolutions whether or not the bag has them; the service checks the bag.
    expect((await pokemonView(row, trainer, T0)).evolution.options.map((o) => o.to)).toContain("flareon");

    const outcome = await evolve(t.db, trainer, row.id, "flareon", T0);
    expect(outcome.from).toBe("eevee");
    expect(outcome.to).toBe("flareon");
    expect(outcome.view.species).toBe("flareon");
    expect(outcome.view.name).toBe("Vee");
    expect(outcome.view.level).toBe(row.stats.level);
    expect(outcome.view.stats.evolution.stage).toBe(row.stats.evolution.stage + 1);
    expect(outcome.bytes).toBe(milestoneBonus("evolution"));
    expect(outcome.balance).toBe(1000 - storeItem("fire_stone")!.price + milestoneBonus("evolution"));

    const bag = await t.db.query.bag.findMany({ where: eq(schema.bag.trainerId, trainer.id) });
    expect(bag.find((b) => b.itemId === "fire_stone")?.qty ?? 0).toBe(0);
    const saved = await reload(row.id);
    expect(saved.identity.species).toBe("flareon");
    expect(saved.identity.nationalDex).toBe(136);
    expect(saved.pokedex.species).toBe("flareon");
    expect(saved.history.milestones.at(-1)).toMatchObject({ kind: "evolution", detail: "eevee -> flareon" });
    const events = await t.db.query.event.findMany({ where: eq(schema.event.pokemonId, row.id) });
    expect(events.some((e) => e.summary === "Vee evolved from Eevee into Flareon")).toBe(true);
  });

  it("asks by level, and a no keeps the ask away for the snooze or for good", async () => {
    const trainer = await makeTrainer(t.db, "eli");
    const row = await insertPokemon(t.db, trainer, { species: "charmander", slot: 1, active: true });
    expect((await pokemonView(row, trainer, T0)).evolution.options).toEqual([]);
    await t.db
      .update(schema.pokemon)
      .set({ stats: { ...row.stats, level: 16 } })
      .where(eq(schema.pokemon.id, row.id));
    expect((await pokemonView(await reload(row.id), trainer, T0)).evolution.options.map((o) => o.to)).toEqual(["charmeleon"]);

    const snoozed = await decline(t.db, trainer, row.id, false, T0);
    expect(snoozed.evolution.options).toEqual([]);
    expect(snoozed.evolution.declinedUntil).toBe(later(T0, EVOLUTION_SNOOZE));
    const afterSnooze = later(T0, EVOLUTION_SNOOZE + 1000);
    expect((await pokemonView(await reload(row.id), trainer, afterSnooze)).evolution.options.map((o) => o.to)).toEqual(["charmeleon"]);

    const never = await decline(t.db, trainer, row.id, true, T0);
    expect(never.evolution.blocked).toBe(true);
    expect(never.evolution.options).toEqual([]);
    await expect(evolve(t.db, trainer, row.id, "charmeleon", afterSnooze)).rejects.toMatchObject({ code: "cannot_evolve" });
  });
});
