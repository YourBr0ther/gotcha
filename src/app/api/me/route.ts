import { z } from "zod";
import { getBag, setTimezone } from "@/lib/services/trainers";
import { listOwned, partyOf } from "@/lib/services/pokemon";
import { json, parseBody, withTrainer } from "../_lib/handler";

export const GET = withTrainer(async (_request, { db, trainer }) => {
  const owned = await listOwned(db, trainer.id);
  return json({
    id: trainer.id,
    username: trainer.username,
    name: trainer.displayName,
    bytes: trainer.bytes,
    timezone: trainer.timezone,
    createdAt: trainer.createdAt,
    bag: await getBag(db, trainer.id),
    counts: { party: partyOf(owned).length, pc: owned.filter((p) => p.status === "pc").length, inTransit: owned.filter((p) => p.status === "in_transit").length },
  });
});

const Patch = z.object({ timezone: z.string().min(1).max(64) });

/** The client sends its IANA timezone so night and the stipend day are the trainer's. */
export const PATCH = withTrainer(async (request, { db, trainer }) => {
  const body = await parseBody(request, Patch);
  const updated = await setTimezone(db, trainer.id, body.timezone);
  return json({ id: updated.id, timezone: updated.timezone });
});
