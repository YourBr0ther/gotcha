import { z } from "zod";
import { catalog, purchase } from "@/lib/services/store";
import { getBag } from "@/lib/services/trainers";
import { json, parseBody, withTrainer } from "../_lib/handler";

const Post = z.object({ itemId: z.string().min(1).max(40), qty: z.int().min(1).max(99).default(1) });

export const GET = withTrainer(async (_request, { db, trainer }) =>
  json({ bytes: trainer.bytes, catalog: catalog(), bag: await getBag(db, trainer.id) }),
);

export const POST = withTrainer(async (request, { db, trainer }) => {
  const body = await parseBody(request, Post);
  return json(await purchase(db, trainer.id, body.itemId, body.qty));
});
