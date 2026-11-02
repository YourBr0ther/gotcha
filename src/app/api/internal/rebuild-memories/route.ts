import { z } from "zod";
import { getDb } from "@/lib/db";
import { rebuildMemories } from "@/lib/services/rollover";
import { json, plain } from "../../_lib/handler";
import { requireInternal } from "../../_lib/internal";

const Body = z.object({ pokemonId: z.string().uuid().optional() }).default({});

/**
 * Rolls every logged day up again from the event log, for one pokemon or
 * all of them: the diary pages, the rolling memory and the relationship are
 * rebuilt as if each night had run with today's prompt. The owner calls it
 * after changing how the roll-up writes.
 */
export const POST = plain(async (request) => {
  requireInternal(request);
  const body = Body.parse(await request.json().catch(() => ({})));
  return json(await rebuildMemories(getDb(), body.pokemonId));
});
