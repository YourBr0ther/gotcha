import { z } from "zod";
import { starterSpecies } from "@/lib/services/pokedex";
import { createStarter } from "@/lib/services/starter";
import { pokemonView } from "@/lib/services/views";
import { json, parseBody, withTrainer } from "../_lib/handler";

const Body = z.object({
  species: z.string().min(1).max(40),
  nickname: z.string().trim().min(1).max(12).optional(),
  gender: z.enum(["male", "female", "genderless"]).optional(),
});

/** Every species a trainer can start with: `{ species: [{ id, name, dex, types, dioramas }] }`. */
export const GET = withTrainer(async () => json({ species: await starterSpecies() }));

export const POST = withTrainer(async (request, { db, trainer, now }) => {
  const body = await parseBody(request, Body);
  const row = await createStarter(db, trainer, body, now);
  return json({ pokemon: await pokemonView(row, trainer, now) }, { status: 201 });
});
