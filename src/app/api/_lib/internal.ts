import { timingSafeEqual } from "node:crypto";
import { ServiceError } from "@/lib/services/errors";

/** The internal routes share one bearer token, ROLLOVER_TOKEN, which the CronJob and the owner hold. */
export function requireInternal(request: Request): void {
  const expected = process.env.ROLLOVER_TOKEN?.trim();
  const header = request.headers.get("authorization") ?? "";
  const given = header.startsWith("Bearer ") ? header.slice(7).trim() : "";
  const a = Buffer.from(given);
  const b = Buffer.from(expected ?? "");
  if (!expected || a.length !== b.length || !timingSafeEqual(a, b)) throw new ServiceError("unauthenticated", "bearer token missing or wrong");
}
