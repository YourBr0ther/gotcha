/**
 * The store. A purchase debits Bytes, writes the ledger and adds to the bag
 * in one transaction; the balance never goes under zero.
 */

import { sql } from "drizzle-orm";
import { storeCatalog, storeItem, type StoreItem } from "@/lib/sim";
import { schema, type Db } from "@/lib/db";
import { ServiceError } from "./errors";
import { adjustBytes, getBag } from "./trainers";

export interface PurchaseResult {
  item: StoreItem;
  qty: number;
  cost: number;
  balance: number;
  bag: Array<{ itemId: string; qty: number }>;
}

export function catalog(): StoreItem[] {
  return storeCatalog();
}

export async function purchase(db: Db, trainerId: string, itemId: string, qty = 1): Promise<PurchaseResult> {
  if (!Number.isInteger(qty) || qty < 1 || qty > 99) throw new ServiceError("bad_request", "qty must be a whole number from 1 to 99");
  const item = storeItem(itemId);
  if (!item) throw new ServiceError("unknown_item", `unknown item "${itemId}"`);
  const cost = item.price * qty;

  return db.transaction(async (tx) => {
    const balance = await adjustBytes(tx, trainerId, -cost, "purchase", `${item.id}x${qty}`);
    await tx
      .insert(schema.bag)
      .values({ trainerId, itemId: item.id, qty })
      .onConflictDoUpdate({ target: [schema.bag.trainerId, schema.bag.itemId], set: { qty: sql`${schema.bag.qty} + ${qty}` } });
    return { item, qty, cost, balance, bag: await getBag(tx, trainerId) };
  });
}
