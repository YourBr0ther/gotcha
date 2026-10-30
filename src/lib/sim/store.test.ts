import { describe, expect, it } from "vitest";
import { STORE_ITEMS } from "./constants";
import { isStoreItemId, storeCatalog, storeItem } from "./store";

describe("store", () => {
  it("lists every item in constants with its price", () => {
    const catalog = storeCatalog();
    const ids = Object.keys(STORE_ITEMS);
    expect(catalog.map((i) => i.id).sort()).toEqual(ids.sort());
    for (const item of catalog) {
      expect(item.price).toBe(STORE_ITEMS[item.id].price);
      expect(item.price).toBeGreaterThan(0);
      expect(item.name.length).toBeGreaterThan(0);
    }
  });

  it("gives every food a hunger fill, every toy a modifier, every diorama an unlock", () => {
    for (const item of storeCatalog()) {
      if (["berry", "poffin", "curry"].includes(item.category)) expect(item.effects.fill?.hunger).toBeGreaterThan(0);
      if (item.category === "toy") expect(item.effects.modifier?.factor).toBeLessThan(1);
      if (item.category === "diorama") expect(item.effects.unlock).toBeTruthy();
      if (item.category === "medicine") expect(item.effects.cureSickness).toBe(true);
    }
  });

  it("hands out copies so callers cannot change the catalog", () => {
    const a = storeItem("oran_berry")!;
    a.price = 1;
    a.effects.fill!.hunger = 999;
    expect(storeItem("oran_berry")).toMatchObject({ price: STORE_ITEMS.oran_berry.price, effects: { fill: { hunger: STORE_ITEMS.oran_berry.fill.hunger } } });
    expect(storeCatalog()).not.toBe(storeCatalog());
  });

  it("knows what it does not sell", () => {
    expect(storeItem("rare_candy")).toBeUndefined();
    expect(isStoreItemId("rare_candy")).toBe(false);
    expect(isStoreItemId("curry")).toBe(true);
  });
});
