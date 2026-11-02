import { getDb } from "@/lib/db";
import { rollover } from "@/lib/services/rollover";
import { json, plain } from "../../_lib/handler";
import { requireInternal } from "../../_lib/internal";

/** Nightly: stipend, event roll-up, trade expiry. A CronJob calls this with the shared token. */
export const POST = plain(async (request) => {
  requireInternal(request);
  return json(await rollover(getDb()));
});
