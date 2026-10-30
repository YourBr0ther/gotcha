import { afterAll, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { connect } from "./index";
import { runMigrations } from "./migrate";

/** The production path: migrate the public schema of the local dev database, twice. */
describe("runMigrations", () => {
  const conn = connect();
  afterAll(() => conn.sql.end());

  it("is idempotent against the local database", async () => {
    await runMigrations(conn.db);
    await runMigrations(conn.db);
    const tables = await conn.db.execute<{ table_name: string }>(sql`select table_name from information_schema.tables where table_schema = 'public' order by table_name`);
    const names = tables.map((r) => r.table_name);
    for (const expected of ["bag", "brain_usage", "event", "ledger", "pokemon", "trade", "trainer"]) expect(names).toContain(expected);
  });
});
