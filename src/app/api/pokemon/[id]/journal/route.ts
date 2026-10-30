import { getJournal } from "@/lib/services/journal";
import { json, requireUuid, withTrainer } from "../../../_lib/handler";

/** Memories and the nightly journal rows for one of the trainer's pokemon. */
export const GET = withTrainer<{ id: string }>(async (_request, { db, trainer }, { id }) => json(await getJournal(db, trainer.id, requireUuid(id))));
