import { submitRound } from "@/lib/services/games";
import { json, parseBody, withTrainer } from "../../_lib/handler";
import { ResultBody } from "../_lib/schemas";

/**
 * POST { token, gameId, score, maxScore, durationMs, perfect }. Pays the
 * round once; a second submission of the same token is a 409.
 */
export const POST = withTrainer(async (request, { db, trainer, now }) => {
  const body = await parseBody(request, ResultBody);
  return json(await submitRound(db, trainer, body, now));
});
