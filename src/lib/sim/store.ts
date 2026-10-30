/**
 * The store. Every item's effect is in engine terms (fill hunger by 20,
 * fun decay 0.7x for a day) so no other module needs item-specific code.
 */

import { STORE_ITEMS, type StoreItemId } from "./constants";
import type { StoreCategory, StoreItem } from "./types";

function titleCase(id: string): string {
  return id
    .split("_")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

const CATALOG: readonly StoreItem[] = (Object.keys(STORE_ITEMS) as StoreItemId[]).map((id) => {
  const def = STORE_ITEMS[id];
  const item: StoreItem = {
    id,
    name: titleCase(id),
    category: def.category as StoreCategory,
    price: def.price,
    effects: {},
  };
  if ("fill" in def) item.effects.fill = { ...def.fill };
  if ("flavors" in def) item.effects.flavors = [...def.flavors];
  if ("cureSickness" in def) item.effects.cureSickness = def.cureSickness;
  if ("modifier" in def) item.effects.modifier = { ...def.modifier };
  if ("unlock" in def) item.effects.unlock = def.unlock;
  return item;
});

/** A fresh copy each call, so callers may not corrupt the catalog. */
export function storeCatalog(): StoreItem[] {
  return CATALOG.map(cloneItem);
}

export function storeItem(id: string): StoreItem | undefined {
  const found = CATALOG.find((item) => item.id === id);
  return found ? cloneItem(found) : undefined;
}

export function isStoreItemId(id: string): id is StoreItemId {
  return Object.prototype.hasOwnProperty.call(STORE_ITEMS, id);
}

function cloneItem(item: StoreItem): StoreItem {
  const effects = { ...item.effects };
  if (effects.fill) effects.fill = { ...effects.fill };
  if (effects.flavors) effects.flavors = [...effects.flavors];
  if (effects.modifier) effects.modifier = { ...effects.modifier };
  return { ...item, effects };
}
