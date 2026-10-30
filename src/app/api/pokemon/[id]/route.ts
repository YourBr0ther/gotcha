import { getPokemon } from "@/lib/services/pokemon";
import { pokemonView } from "@/lib/services/views";
import { json, requireUuid, withTrainer } from "../../_lib/handler";

/** The decayed view: state as of now, mood and needs. Nothing is written. */
export const GET = withTrainer<{ id: string }>(async (_request, { db, trainer, now }, { id }) => {
  const row = await getPokemon(db, trainer.id, requireUuid(id));
  return json(await pokemonView(row, trainer, now));
});
