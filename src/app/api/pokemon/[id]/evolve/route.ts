import { z } from "zod";
import { decline, evolve } from "@/lib/services/evolution";
import { json, parseBody, requireUuid, withTrainer } from "../../../_lib/handler";

/** `{ to }` evolves into that species; `{ decline: "now" | "forever" }` answers the ask with a no. */
const Body = z.union([z.object({ to: z.string().min(1).max(40) }), z.object({ decline: z.enum(["now", "forever"]) })]);

export const POST = withTrainer<{ id: string }>(async (request, { db, trainer, now }, { id }) => {
  const body = await parseBody(request, Body);
  const pokemonId = requireUuid(id);
  if ("to" in body) return json(await evolve(db, trainer, pokemonId, body.to, now));
  return json({ view: await decline(db, trainer, pokemonId, body.decline === "forever", now) });
});
