import { startRound } from "@/lib/services/games";
import { json, parseBody, withTrainer } from "../../_lib/handler";
import { StartBody } from "../_lib/schemas";

/**
 * POST { gameId }. Answers the round token the result must carry back,
 * today's totals, the cap, and what a perfect round pays right now.
 */
export const POST = withTrainer(async (request, { db, trainer, now }) => {
  const body = await parseBody(request, StartBody);
  return json(await startRound(db, trainer, body.gameId, now));
});
