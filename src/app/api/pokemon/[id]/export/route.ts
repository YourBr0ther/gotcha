import { z } from "zod";
import { exportPokemon } from "@/lib/services/transfer";
import { parseQuery, requireUuid, withTrainer } from "../../../_lib/handler";

const Query = z.object({ mode: z.enum(["backup", "trade"]).default("backup") });

/** The .cpkmn bytes. mode=trade also locks the pokemon as in_transit. */
export const GET = withTrainer<{ id: string }>(async (request, { db, trainer, now }, { id }) => {
  const { mode } = parseQuery(request, Query);
  const result = await exportPokemon(db, trainer, requireUuid(id), mode, now);
  return new Response(result.bytes as BodyInit, {
    status: 200,
    headers: {
      "Content-Type": result.contentType,
      "Content-Disposition": `attachment; filename="${result.filename}"`,
      "Content-Length": String(result.bytes.byteLength),
      "Cache-Control": "no-store",
      ...(result.trade ? { "X-Cpkmn-Trade-Nonce": result.trade.nonce } : {}),
    },
  });
});
