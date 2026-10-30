import { timingSafeEqual } from "node:crypto";
import { getDb } from "@/lib/db";
import { ServiceError } from "@/lib/services/errors";
import { rollover } from "@/lib/services/rollover";
import { json, plain } from "../../_lib/handler";

function authorized(request: Request): boolean {
  const expected = process.env.ROLLOVER_TOKEN?.trim();
  if (!expected) return false;
  const header = request.headers.get("authorization") ?? "";
  const given = header.startsWith("Bearer ") ? header.slice(7).trim() : "";
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

/** Nightly: stipend, event roll-up, trade expiry. A CronJob calls this with the shared token. */
export const POST = plain(async (request) => {
  if (!authorized(request)) throw new ServiceError("unauthenticated", "bearer token missing or wrong");
  return json(await rollover(getDb()));
});
