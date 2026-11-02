/**
 * How items look on screen: which pixel glyph, which tint, and which care
 * action a bag item is used with. The effects themselves come from the
 * catalog; nothing here changes a number.
 */

import type { PixelIconName } from "@/components/pixel/PixelIcon";
import type { CareAction, StoreItem } from "@/lib/sim";

export type Category = StoreItem["category"];

export const CATEGORY_LABEL: Record<Category, string> = {
  berry: "Berries",
  poffin: "Poffins",
  curry: "Curry",
  potion: "Potions",
  medicine: "Medicine",
  toy: "Toys",
  decoration: "Decorations",
  diorama: "Places",
  key: "Key items",
};

export const CATEGORY_ORDER: Category[] = ["berry", "poffin", "curry", "potion", "medicine", "toy", "decoration", "diorama", "key"];

const BERRY_TINT: Record<string, { b: string; B: string }> = {
  oran_berry: { b: "#4a6cf0", B: "#8fa6ff" },
  sitrus_berry: { b: "#f2c230", B: "#ffe58a" },
  cheri_berry: { b: "#e5322d", B: "#ff8a80" },
  chesto_berry: { b: "#8a4ad8", B: "#c49cff" },
  pecha_berry: { b: "#ff8ab8", B: "#ffc2d9" },
  rawst_berry: { b: "#5ad64b", B: "#a6f09a" },
};

export function itemGlyph(item: Pick<StoreItem, "id" | "category">): { name: PixelIconName; tint?: Record<string, string> } {
  switch (item.category) {
    case "berry":
      return { name: "berry", tint: BERRY_TINT[item.id] };
    case "poffin":
      return { name: "poffin" };
    case "curry":
      return { name: "curry" };
    case "potion":
      return { name: "potion", tint: item.id === "super_potion" ? { m: "#c47bff" } : undefined };
    case "medicine":
      return { name: "medicine" };
    case "toy":
      return item.id === "plush_toy" ? { name: "bond" } : { name: "pokeball" };
    case "decoration":
      return item.id === "flower_pot" ? { name: "flowerpot" } : item.id === "lantern" ? { name: "sun" } : { name: "pillow" };
    case "diorama":
      return { name: "tree" };
    case "key":
      return { name: "stone" };
  }
}

/** The care action a bag item is used through, or null when it is not usable on a pokemon. */
export function itemAction(item: StoreItem): CareAction | null {
  if (item.effects.fill?.hunger) return "feed";
  if (item.category === "toy") return "play";
  if (item.category === "medicine" || item.category === "potion") return "medicine";
  return null;
}

export function describeEffects(item: StoreItem): string {
  const parts: string[] = [];
  const fill = item.effects.fill ?? {};
  const names: Record<string, string> = { hunger: "Hunger", energy: "Energy", hygiene: "Hygiene", fun: "Happiness", affection: "Bond", health: "Health" };
  for (const [need, amount] of Object.entries(fill)) if (amount) parts.push(`+${amount} ${names[need] ?? need}`);
  if (item.effects.cureSickness) parts.push("cures sickness");
  if (item.effects.modifier) parts.push(`${names[item.effects.modifier.need]} lasts longer for a day`);
  if (item.effects.unlock) parts.push(`somewhere new to live, the ${item.effects.unlock}`);
  if (item.category === "decoration") parts.push("for where your pokemon lives");
  if (item.category === "key" && parts.length === 0) parts.push("for evolution");
  return parts.join(", ");
}
