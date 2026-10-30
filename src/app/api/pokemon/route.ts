import { listOwned } from "@/lib/services/pokemon";
import { pokemonView } from "@/lib/services/views";
import { json, withTrainer } from "../_lib/handler";

/** Every pokemon the trainer owns (party, PC and in transit), decayed to now. */
export const GET = withTrainer(async (_request, { db, trainer, now }) => {
  const rows = await listOwned(db, trainer.id);
  return json({ pokemon: await Promise.all(rows.map((r) => pokemonView(r, trainer, now))) });
});
