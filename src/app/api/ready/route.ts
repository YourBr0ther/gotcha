import { sql } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { json, plain } from "../_lib/handler";

/** Readiness: the database answers and the schema is migrated. */
export const GET = plain(async () => {
  try {
    const db = getDb();
    await db.execute(sql`select 1`);
    await db.execute(sql`select 1 from trainer limit 1`);
    return json({ ok: true, db: "ready" });
  } catch (error) {
    return json({ ok: false, db: "unavailable", error: (error as Error).message }, { status: 503 });
  }
});
