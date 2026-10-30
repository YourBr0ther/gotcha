/**
 * The bag outside of buying and using: tossing items. A discard moves no
 * Bytes but still writes a ledger row (delta 0, reason "discard") so the
 * audit trail shows where the item went.
 */

import { and, eq, sql } from "drizzle-orm";
import { schema, type Db } from "@/lib/db";
import { ServiceError } from "./errors";
import { getBag } from "./trainers";

export interface DiscardResult {
  itemId: string;
  qty: number;
  remaining: number;
  bag: Array<{ itemId: string; qty: number }>;
}

export async function discard(db: Db, trainerId: string, itemId: string, qty = 1, now = new Date().toISOString()): Promise<DiscardResult> {
  if (!Number.isInteger(qty) || qty < 1 || qty > 99) throw new ServiceError("bad_request", "qty must be a whole number from 1 to 99");
  return db.transaction(async (tx) => {
    const [row] = await tx
      .select({ qty: schema.bag.qty })
      .from(schema.bag)
      .where(and(eq(schema.bag.trainerId, trainerId), eq(schema.bag.itemId, itemId)))
      .for("update");
    if (!row || row.qty < 1) throw new ServiceError("item_not_in_bag", `no ${itemId.replace(/_/g, " ")} in the bag`);
    if (row.qty < qty) throw new ServiceError("item_not_in_bag", `only ${row.qty} ${itemId.replace(/_/g, " ")} in the bag`);
    const remaining = row.qty - qty;
    await tx
      .update(schema.bag)
      .set({ qty: sql`${schema.bag.qty} - ${qty}` })
      .where(and(eq(schema.bag.trainerId, trainerId), eq(schema.bag.itemId, itemId)));
    await tx.insert(schema.ledger).values({ trainerId, delta: 0, reason: "discard", ref: `${itemId}x${qty}`, at: now });
    return { itemId, qty, remaining, bag: await getBag(tx, trainerId) };
  });
}
