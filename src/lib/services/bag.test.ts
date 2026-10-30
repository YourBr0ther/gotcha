import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { schema } from "@/lib/db";
import { createTestDb, type TestDb } from "@/lib/db/testing";
import { storeItem } from "@/lib/sim";
import { discard } from "./bag";
import { purchase } from "./store";
import { giveBytes, makeTrainer, T0 } from "./testing";

let t: TestDb;
beforeEach(async () => {
  t ??= await createTestDb("bag");
  await t.truncate();
});
afterAll(() => t?.cleanup());

describe("bag discard", () => {
  it("takes the items out, leaves Bytes alone, and writes a zero-delta ledger row", async () => {
    const berry = storeItem("oran_berry")!;
    const trainer = await giveBytes(t.db, await makeTrainer(t.db, "eli"), berry.price * 3);
    await purchase(t.db, trainer.id, "oran_berry", 3);

    const result = await discard(t.db, trainer.id, "oran_berry", 2, T0);
    expect(result).toEqual({ itemId: "oran_berry", qty: 2, remaining: 1, bag: [{ itemId: "oran_berry", qty: 1 }] });

    const saved = await t.db.query.trainer.findFirst({ where: eq(schema.trainer.id, trainer.id) });
    expect(saved?.bytes).toBe(0);
    const ledger = await t.db.query.ledger.findMany({ where: eq(schema.ledger.trainerId, trainer.id), orderBy: (l, { asc }) => [asc(l.id)] });
    expect(ledger.map((l) => [l.reason, l.delta, l.ref])).toEqual([
      ["purchase", -berry.price * 3, "oran_berryx3"],
      ["discard", 0, "oran_berryx2"],
    ]);
    expect(new Date(ledger[1].at).toISOString()).toBe(T0);

    // Tossing the last one leaves the bag empty rather than at a negative count.
    const last = await discard(t.db, trainer.id, "oran_berry", 1);
    expect(last.bag).toEqual([]);
    await expect(discard(t.db, trainer.id, "oran_berry", 1)).rejects.toMatchObject({ code: "item_not_in_bag" });
  });

  it("refuses more than the bag holds, unknown items and bad quantities, and leaves nothing behind", async () => {
    const berry = storeItem("oran_berry")!;
    const trainer = await giveBytes(t.db, await makeTrainer(t.db, "eli"), berry.price);
    await purchase(t.db, trainer.id, "oran_berry", 1);
    await expect(discard(t.db, trainer.id, "oran_berry", 2)).rejects.toMatchObject({ code: "item_not_in_bag" });
    await expect(discard(t.db, trainer.id, "curry", 1)).rejects.toMatchObject({ code: "item_not_in_bag" });
    await expect(discard(t.db, trainer.id, "oran_berry", 0)).rejects.toMatchObject({ code: "bad_request" });
    await expect(discard(t.db, trainer.id, "oran_berry", 1.5)).rejects.toMatchObject({ code: "bad_request" });
    const bag = await t.db.query.bag.findMany({ where: eq(schema.bag.trainerId, trainer.id) });
    expect(bag.map((b) => [b.itemId, b.qty])).toEqual([["oran_berry", 1]]);
    const ledger = await t.db.query.ledger.findMany({ where: eq(schema.ledger.trainerId, trainer.id) });
    expect(ledger.map((l) => l.reason)).toEqual(["purchase"]);
  });
});
