import { z } from "zod";
import { deposit, getBoxes, release, withdraw } from "@/lib/services/pc";
import { json, parseBody, uuid, withTrainer } from "../_lib/handler";

const Post = z.discriminatedUnion("op", [
  z.object({ op: z.literal("deposit"), pokemonId: uuid, box: z.int().min(1).optional(), boxSlot: z.int().min(1).max(30).optional() }),
  z.object({ op: z.literal("withdraw"), pokemonId: uuid }),
  z.object({ op: z.literal("release"), pokemonId: uuid }),
]);

export const GET = withTrainer(async (_request, { db, trainer, now }) => json(await getBoxes(db, trainer, now)));

export const POST = withTrainer(async (request, { db, trainer, now }) => {
  const body = await parseBody(request, Post);
  switch (body.op) {
    case "deposit":
      await deposit(db, trainer, body.pokemonId, { box: body.box, boxSlot: body.boxSlot });
      break;
    case "withdraw":
      await withdraw(db, trainer, body.pokemonId);
      break;
    case "release":
      await release(db, trainer, body.pokemonId);
      break;
  }
  return json(await getBoxes(db, trainer, now));
});
