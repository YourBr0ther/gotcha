import { z } from "zod";
import { TRAINER_TEXT_MAX_CHARS } from "@/lib/brain/constants";
import { talkTo } from "@/lib/brain/converse";
import { json, parseBody, requireUuid, withTrainer } from "../../../_lib/handler";

const Body = z.object({
  text: z.string().min(1).max(TRAINER_TEXT_MAX_CHARS),
});

/**
 * POST { text } from the trainer, typed or transcribed. Answers
 * { line, emote, cry, activity?, source }. Only the owner can talk to a
 * pokemon, and one out for trade does not answer.
 */
export const POST = withTrainer<{ id: string }>(async (request, { db, trainer, now }, { id }) => {
  const body = await parseBody(request, Body);
  const reply = await talkTo(db, trainer, requireUuid(id), body.text, now);
  return json(reply);
});
