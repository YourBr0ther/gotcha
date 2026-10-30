import { z } from "zod";
import { getParty, updateParty } from "@/lib/services/party";
import { json, parseBody, uuid, withTrainer } from "../_lib/handler";

const Put = z
  .object({
    order: z.array(uuid).max(6).optional(),
    activeId: uuid.optional(),
  })
  .refine((b) => b.order !== undefined || b.activeId !== undefined, { message: "send order, activeId or both" });

export const GET = withTrainer(async (_request, { db, trainer, now }) => json(await getParty(db, trainer, now)));

export const PUT = withTrainer(async (request, { db, trainer, now }) => {
  const body = await parseBody(request, Put);
  await updateParty(db, trainer, body);
  return json(await getParty(db, trainer, now));
});
