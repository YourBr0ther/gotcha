import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { schema } from "@/lib/db";
import { createTestDb, type TestDb } from "@/lib/db/testing";
import { storeItem } from "@/lib/sim";
import { catalog, purchase } from "./store";
import { giveBytes, makeTrainer } from "./testing";

let t: TestDb;
beforeEach(async () => {
  t ??= await createTestDb("store");
  await t.truncate();
});
afterAll(() => t?.cleanup());

describe("store", () => {
  it("lists the engine catalog", () => {
    expect(catalog().some((i) => i.id === "oran_berry")).toBe(true);
  });

  it("debits Bytes, adds to the bag and writes the ledger together", async () => {
    const berry = storeItem("oran_berry")!;
    const trainer = await giveBytes(t.db, await makeTrainer(t.db, "eli"), berry.price * 3);
    const result = await purchase(t.db, trainer.id, "oran_berry", 2);
    expect(result.cost).toBe(berry.price * 2);
    expect(result.balance).toBe(berry.price);
    expect(result.bag).toEqual([{ itemId: "oran_berry", qty: 2 }]);

    await purchase(t.db, trainer.id, "oran_berry", 1);
    const bag = await t.db.query.bag.findMany({ where: eq(schema.bag.trainerId, trainer.id) });
    expect(bag.map((b) => [b.itemId, b.qty])).toEqual([["oran_berry", 3]]);
    const ledger = await t.db.query.ledger.findMany({ where: eq(schema.ledger.trainerId, trainer.id) });
    expect(ledger.map((l) => l.delta)).toEqual([-berry.price * 2, -berry.price]);
    expect(ledger.reduce((sum, l) => sum + l.delta, 0)).toBe(-berry.price * 3);
    const saved = await t.db.query.trainer.findFirst({ where: eq(schema.trainer.id, trainer.id) });
    expect(saved?.bytes).toBe(0);
  });

  it("cannot go negative and leaves nothing behind when it fails", async () => {
    const curry = storeItem("curry")!;
    const trainer = await giveBytes(t.db, await makeTrainer(t.db, "eli"), curry.price - 1);
    await expect(purchase(t.db, trainer.id, "curry", 1)).rejects.toMatchObject({ code: "insufficient_bytes" });
    const saved = await t.db.query.trainer.findFirst({ where: eq(schema.trainer.id, trainer.id) });
    expect(saved?.bytes).toBe(curry.price - 1);
    expect(await t.db.query.bag.findMany({ where: eq(schema.bag.trainerId, trainer.id) })).toEqual([]);
    expect(await t.db.query.ledger.findMany({ where: eq(schema.ledger.trainerId, trainer.id) })).toEqual([]);
  });

  it("rejects unknown items and bad quantities", async () => {
    const trainer = await giveBytes(t.db, await makeTrainer(t.db, "eli"), 1000);
    await expect(purchase(t.db, trainer.id, "master_ball", 1)).rejects.toMatchObject({ code: "unknown_item" });
    await expect(purchase(t.db, trainer.id, "oran_berry", 0)).rejects.toMatchObject({ code: "bad_request" });
    await expect(purchase(t.db, trainer.id, "oran_berry", 1.5)).rejects.toMatchObject({ code: "bad_request" });
  });
});
