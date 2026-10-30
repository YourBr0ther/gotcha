import { json, plain } from "../_lib/handler";

/** Liveness. Says nothing about the database; see /api/ready. */
export const GET = plain(async () => json({ ok: true, at: new Date().toISOString() }));
