import { z } from "zod";
import { discard } from "@/lib/services/bag";
import { getBag } from "@/lib/services/trainers";
import { json, parseBody, withTrainer } from "../_lib/handler";

const Post = z.discriminatedUnion("op", [z.object({ op: z.literal("discard"), itemId: z.string().min(1).max(40), qty: z.int().min(1).max(99).default(1) })]);

export const GET = withTrainer(async (_request, { db, trainer }) => json({ bag: await getBag(db, trainer.id) }));

/** `{ op: "discard", itemId, qty }` tosses items; the ledger records it at delta 0. */
export const POST = withTrainer(async (request, { db, trainer, now }) => {
  const body = await parseBody(request, Post);
  return json(await discard(db, trainer.id, body.itemId, body.qty, now));
});
