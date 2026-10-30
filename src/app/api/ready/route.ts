import { existsSync } from "node:fs";
import path from "node:path";
import { sql } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { pokedexCacheDir } from "@/lib/services/pokedex";
import { json, plain } from "../_lib/handler";

/**
 * Readiness: the database answers, the schema is migrated, and the pokedex
 * cache exists. On a first start the entrypoint builds that cache in the
 * background, so the pod reports "warming" (503) until it lands and traffic
 * waits rather than hitting a starter picker with no species.
 */
export const GET = plain(async () => {
  try {
    const db = getDb();
    await db.execute(sql`select 1`);
    await db.execute(sql`select 1 from trainer limit 1`);
    const pokedexReady = existsSync(path.join(pokedexCacheDir(), "species", "index.json"));
    if (!pokedexReady) return json({ ok: false, db: "ready", pokedex: "warming" }, { status: 503 });
    return json({ ok: true, db: "ready", pokedex: "ready" });
  } catch (error) {
    // The message can name hosts and credentials; keep it in the server log.
    console.error("[ready] database check failed", error);
    return json({ ok: false, db: "unavailable" }, { status: 503 });
  }
});
