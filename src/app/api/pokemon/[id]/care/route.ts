import { z } from "zod";
import { care } from "@/lib/services/care";
import { CARE_ACTIONS } from "@/lib/sim";
import { json, parseBody, requireUuid, withTrainer } from "../../../_lib/handler";

const Body = z.object({
  action: z.enum(CARE_ACTIONS),
  item: z.string().min(1).max(40).optional(),
});

export const POST = withTrainer<{ id: string }>(async (request, { db, trainer, now }, { id }) => {
  const body = await parseBody(request, Body);
  const outcome = await care(db, trainer, requireUuid(id), body, now);
  return json(outcome);
});
