import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { createTestDb, type TestDb } from "@/lib/db/testing";
import { getParty } from "./party";
import { deposit, getBoxes, release, withdraw } from "./pc";
import { BOX_SIZE } from "./pokemon";
import { insertPokemon, makeTrainer, T0 } from "./testing";
import { exportPokemon } from "./transfer";

let t: TestDb;
beforeEach(async () => {
  t ??= await createTestDb("pc");
  await t.truncate();
});
afterAll(() => t?.cleanup());

describe("pc", () => {
  it("deposits into the first free slot of box 1 and promotes a new active", async () => {
    const trainer = await makeTrainer(t.db, "eli");
    const a = await insertPokemon(t.db, trainer, { slot: 1, active: true });
    const b = await insertPokemon(t.db, trainer, { slot: 2 });
    await deposit(t.db, trainer, a.id);
    const boxes = await getBoxes(t.db, trainer, T0);
    expect(boxes.boxSize).toBe(BOX_SIZE);
    expect(boxes.boxes[0].pokemon.map((p) => [p.id, p.box, p.boxSlot])).toEqual([[a.id, 1, 1]]);
    const party = await getParty(t.db, trainer, T0);
    expect(party.party.map((p) => p.id)).toEqual([b.id]);
    expect(party.activeId).toBe(b.id);
  });

  it("boxes hold thirty; the thirty-first goes to the next box", async () => {
    const trainer = await makeTrainer(t.db, "eli");
    for (let i = 1; i <= BOX_SIZE; i++) await insertPokemon(t.db, trainer, { status: "pc", slot: null, box: 1, boxSlot: i });
    const extra = await insertPokemon(t.db, trainer, { slot: 1, active: true });
    await deposit(t.db, trainer, extra.id);
    const boxes = await getBoxes(t.db, trainer, T0);
    expect(boxes.boxes).toHaveLength(2);
    expect(boxes.boxes[1].pokemon.map((p) => [p.id, p.box, p.boxSlot])).toEqual([[extra.id, 2, 1]]);

    const another = await insertPokemon(t.db, trainer, { slot: 1, active: true });
    await expect(deposit(t.db, trainer, another.id, { box: 1 })).rejects.toMatchObject({ code: "box_full" });
    await expect(deposit(t.db, trainer, another.id, { box: 1, boxSlot: 3 })).rejects.toMatchObject({ code: "box_slot_taken" });
    await expect(deposit(t.db, trainer, another.id, { box: 1, boxSlot: 31 })).rejects.toMatchObject({ code: "bad_request" });
  });

  it("withdraws into the first free party slot and refuses when the party is full", async () => {
    const trainer = await makeTrainer(t.db, "eli");
    await insertPokemon(t.db, trainer, { slot: 1, active: true });
    await insertPokemon(t.db, trainer, { slot: 3 });
    const boxed = await insertPokemon(t.db, trainer, { status: "pc", slot: null, box: 1, boxSlot: 5 });
    await withdraw(t.db, trainer, boxed.id);
    const party = await getParty(t.db, trainer, T0);
    expect(party.party.find((p) => p.id === boxed.id)?.slot).toBe(2);

    for (const slot of [4, 5, 6]) await insertPokemon(t.db, trainer, { slot });
    const more = await insertPokemon(t.db, trainer, { status: "pc", slot: null, box: 1, boxSlot: 6 });
    await expect(withdraw(t.db, trainer, more.id)).rejects.toMatchObject({ code: "party_full" });
  });

  it("withdrawing into an empty party makes that pokemon active", async () => {
    const trainer = await makeTrainer(t.db, "eli");
    const boxed = await insertPokemon(t.db, trainer, { status: "pc", slot: null, box: 1, boxSlot: 1 });
    await withdraw(t.db, trainer, boxed.id);
    expect((await getParty(t.db, trainer, T0)).activeId).toBe(boxed.id);
  });

  it("releases and promotes, and never touches an in_transit pokemon", async () => {
    const trainer = await makeTrainer(t.db, "eli");
    const a = await insertPokemon(t.db, trainer, { slot: 1, active: true });
    const b = await insertPokemon(t.db, trainer, { slot: 2 });
    await release(t.db, trainer, a.id);
    const party = await getParty(t.db, trainer, T0);
    expect(party.party.map((p) => p.id)).toEqual([b.id]);
    expect(party.activeId).toBe(b.id);
    await expect(deposit(t.db, trainer, a.id)).rejects.toMatchObject({ code: "not_found" });

    const away = await insertPokemon(t.db, trainer, { slot: 3 });
    await exportPokemon(t.db, trainer, away.id, "trade", T0, { knownKeys: {}, installId: "test" });
    await expect(deposit(t.db, trainer, away.id)).rejects.toMatchObject({ code: "in_transit" });
    await expect(release(t.db, trainer, away.id)).rejects.toMatchObject({ code: "in_transit" });
  });
});
