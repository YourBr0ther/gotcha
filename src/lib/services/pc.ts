/**
 * The PC: boxes of thirty. A deposited pokemon leaves its party slot; a
 * withdrawn one needs a free slot. Boxes exist implicitly: a box is listed
 * when it holds something or is box 1.
 */

import { eq } from "drizzle-orm";
import { schema, type Db, type DbOrTx } from "@/lib/db";
import type { TrainerRow } from "@/lib/db/schema";
import { ServiceError } from "./errors";
import { reconcileActive } from "./party";
import { assertTouchable, BOX_SIZE, freeBoxSlot, freeSlot, listOwned, lockAll, partyOf } from "./pokemon";
import { pokemonView, type PokemonView } from "./views";

export interface BoxView {
  box: number;
  size: number;
  pokemon: PokemonView[];
}

export async function getBoxes(db: DbOrTx, trainer: TrainerRow, now: string): Promise<{ boxSize: number; boxes: BoxView[] }> {
  const rows = (await listOwned(db, trainer.id)).filter((r) => r.status === "pc" && r.box !== null);
  const highest = rows.reduce((max, r) => Math.max(max, r.box!), 1);
  const boxes: BoxView[] = [];
  for (let b = 1; b <= highest; b++) {
    const inBox = rows.filter((r) => r.box === b).sort((x, y) => x.boxSlot! - y.boxSlot!);
    boxes.push({ box: b, size: BOX_SIZE, pokemon: await Promise.all(inBox.map((r) => pokemonView(r, trainer, now))) });
  }
  return { boxSize: BOX_SIZE, boxes };
}

export async function deposit(db: Db, trainer: TrainerRow, pokemonId: string, target: { box?: number; boxSlot?: number } = {}): Promise<void> {
  await db.transaction(async (tx) => {
    const rows = await lockAll(tx, trainer.id);
    const row = rows.find((r) => r.id === pokemonId);
    if (!row) throw new ServiceError("not_found", "pokemon not found");
    assertTouchable(row);
    if (row.status !== "home") throw new ServiceError("not_in_party", "pokemon is not in the party");

    let place: { box: number; boxSlot: number };
    if (target.box !== undefined && target.boxSlot !== undefined) {
      if (target.box < 1 || target.boxSlot < 1 || target.boxSlot > BOX_SIZE) throw new ServiceError("bad_request", "box slot out of range");
      const taken = rows.some((r) => r.status === "pc" && r.box === target.box && r.boxSlot === target.boxSlot);
      if (taken) throw new ServiceError("box_slot_taken", `box ${target.box} slot ${target.boxSlot} is taken`);
      place = { box: target.box, boxSlot: target.boxSlot };
    } else {
      place = freeBoxSlot(rows, target.box);
    }

    await tx
      .update(schema.pokemon)
      .set({ status: "pc", slot: null, active: false, box: place.box, boxSlot: place.boxSlot, updatedAt: new Date().toISOString() })
      .where(eq(schema.pokemon.id, row.id));
    Object.assign(row, { status: "pc", slot: null, active: false, ...place });
    await reconcileActive(tx, rows);
  });
}

export async function withdraw(db: Db, trainer: TrainerRow, pokemonId: string): Promise<void> {
  await db.transaction(async (tx) => {
    const rows = await lockAll(tx, trainer.id);
    const row = rows.find((r) => r.id === pokemonId);
    if (!row) throw new ServiceError("not_found", "pokemon not found");
    assertTouchable(row);
    if (row.status !== "pc") throw new ServiceError("not_in_pc", "pokemon is not in the PC");
    const slot = freeSlot(rows);
    if (slot === null) throw new ServiceError("party_full", "the party already has six pokemon");

    await tx
      .update(schema.pokemon)
      .set({ status: "home", slot, box: null, boxSlot: null, updatedAt: new Date().toISOString() })
      .where(eq(schema.pokemon.id, row.id));
    Object.assign(row, { status: "home", slot, box: null, boxSlot: null });
    await reconcileActive(tx, rows);
  });
}

/** Releasing keeps the row (its history and events) but it leaves every list for good. */
export async function release(db: Db, trainer: TrainerRow, pokemonId: string): Promise<void> {
  await db.transaction(async (tx) => {
    const rows = await lockAll(tx, trainer.id);
    const row = rows.find((r) => r.id === pokemonId);
    if (!row) throw new ServiceError("not_found", "pokemon not found");
    assertTouchable(row);
    await tx
      .update(schema.pokemon)
      .set({ status: "released", slot: null, active: false, box: null, boxSlot: null, updatedAt: new Date().toISOString() })
      .where(eq(schema.pokemon.id, row.id));
    Object.assign(row, { status: "released", slot: null, active: false, box: null, boxSlot: null });
    await reconcileActive(tx, rows.filter((r) => r.id !== row.id));
  });
}

export { partyOf };
