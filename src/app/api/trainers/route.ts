import { listTrainers } from "@/lib/services/trainers";
import { json, withTrainer } from "../_lib/handler";

/** Everyone on this install with their active pokemon, for the Neighborhood. */
export const GET = withTrainer(async (_request, { db, now }) => json({ trainers: await listTrainers(db, now) }));
