import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { createTestDb, type TestDb } from "@/lib/db/testing";
import { getParty, updateParty } from "./party";
import { insertPokemon, makeTrainer, T0 } from "./testing";
import { exportPokemon } from "./transfer";

let t: TestDb;
beforeEach(async () => {
  t ??= await createTestDb("party");
  await t.truncate();
});
afterAll(() => t?.cleanup());

describe("party", () => {
  it("holds at most six and reports the active one", async () => {
    const trainer = await makeTrainer(t.db, "eli");
    for (let slot = 1; slot <= 6; slot++) await insertPokemon(t.db, trainer, { slot, active: slot === 1 });
    const party = await getParty(t.db, trainer, T0);
    expect(party.party).toHaveLength(6);
    expect(party.activeId).toBe(party.party[0].id);
    await expect(insertPokemon(t.db, trainer, { slot: 7 })).rejects.toThrow();
  });

  it("swaps the active pokemon and keeps exactly one active", async () => {
    const trainer = await makeTrainer(t.db, "eli");
    const a = await insertPokemon(t.db, trainer, { slot: 1, active: true });
    const b = await insertPokemon(t.db, trainer, { slot: 2 });
    await updateParty(t.db, trainer, { activeId: b.id });
    const party = await getParty(t.db, trainer, T0);
    expect(party.activeId).toBe(b.id);
    expect(party.party.filter((p) => p.active).map((p) => p.id)).toEqual([b.id]);
    expect(party.party.find((p) => p.id === a.id)?.active).toBe(false);
  });

  it("reorders slots when given the whole party", async () => {
    const trainer = await makeTrainer(t.db, "eli");
    const a = await insertPokemon(t.db, trainer, { slot: 1, active: true });
    const b = await insertPokemon(t.db, trainer, { slot: 2 });
    const c = await insertPokemon(t.db, trainer, { slot: 3 });
    await updateParty(t.db, trainer, { order: [c.id, a.id, b.id] });
    const party = await getParty(t.db, trainer, T0);
    expect(party.party.map((p) => [p.id, p.slot])).toEqual([
      [c.id, 1],
      [a.id, 2],
      [b.id, 3],
    ]);
    expect(party.activeId).toBe(a.id);
  });

  it("rejects an order that is not the whole party", async () => {
    const trainer = await makeTrainer(t.db, "eli");
    const a = await insertPokemon(t.db, trainer, { slot: 1, active: true });
    await insertPokemon(t.db, trainer, { slot: 2 });
    await expect(updateParty(t.db, trainer, { order: [a.id] })).rejects.toMatchObject({ code: "bad_request" });
  });

  it("will not make a PC or in_transit pokemon active", async () => {
    const trainer = await makeTrainer(t.db, "eli");
    await insertPokemon(t.db, trainer, { slot: 1, active: true });
    const boxed = await insertPokemon(t.db, trainer, { status: "pc", slot: null, box: 1, boxSlot: 1 });
    await expect(updateParty(t.db, trainer, { activeId: boxed.id })).rejects.toMatchObject({ code: "not_in_party" });

    const away = await insertPokemon(t.db, trainer, { slot: 2 });
    await exportPokemon(t.db, trainer, away.id, "trade", T0, { knownKeys: {}, installId: "test" });
    await expect(updateParty(t.db, trainer, { activeId: away.id })).rejects.toMatchObject({ code: "in_transit" });
  });

  it("promotes the lowest slot when the active one leaves for trade", async () => {
    const trainer = await makeTrainer(t.db, "eli");
    const a = await insertPokemon(t.db, trainer, { slot: 1, active: true });
    const b = await insertPokemon(t.db, trainer, { slot: 2 });
    await exportPokemon(t.db, trainer, a.id, "trade", T0, { knownKeys: {}, installId: "test" });
    const party = await getParty(t.db, trainer, T0);
    expect(party.party.map((p) => p.id)).toEqual([b.id]);
    expect(party.activeId).toBe(b.id);
  });

  it("never sees another trainer's pokemon", async () => {
    const eli = await makeTrainer(t.db, "eli");
    const mae = await makeTrainer(t.db, "mae");
    await insertPokemon(t.db, eli, { slot: 1, active: true });
    const hers = await insertPokemon(t.db, mae, { slot: 1, active: true });
    expect((await getParty(t.db, eli, T0)).party).toHaveLength(1);
    await expect(updateParty(t.db, eli, { activeId: hers.id })).rejects.toMatchObject({ code: "not_found" });
  });
});
