/**
 * Test support: an isolated Postgres schema per test file, migrated from
 * drizzle/, dropped on cleanup. Needs the local Postgres from
 * docker-compose.dev.yml (or DATABASE_URL).
 */

import { randomBytes } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { getTableName, is } from "drizzle-orm";
import { PgTable } from "drizzle-orm/pg-core";
import { connect, databaseUrl, type Connection, type Db } from "./index";
import { MIGRATIONS_FOLDER } from "./migrate";
import * as schema from "./schema";

export interface TestDb extends Connection {
  schemaName: string;
  /** Empties every table while keeping the schema. */
  truncate(): Promise<void>;
  /** Drops the schema and closes the pool. */
  cleanup(): Promise<void>;
}

export async function createTestDb(label: string): Promise<TestDb> {
  const schemaName = `test_${label.replace(/[^a-z0-9]/gi, "_").toLowerCase()}_${randomBytes(4).toString("hex")}`;
  const admin = connect(databaseUrl(), { max: 1 });
  await admin.sql.unsafe(`create schema "${schemaName}"`);
  await admin.sql.end();

  const conn = connect(databaseUrl(), { max: 5, connection: { search_path: schemaName } });
  await applyMigrationsTo(conn, schemaName);

  const tables = Object.values(schema)
    .filter((v) => is(v, PgTable))
    .map((t) => `"${schemaName}"."${getTableName(t)}"`);

  return {
    ...conn,
    schemaName,
    async truncate() {
      await conn.sql.unsafe(`truncate ${tables.join(", ")} restart identity cascade`);
    },
    async cleanup() {
      await conn.sql.unsafe(`drop schema "${schemaName}" cascade`);
      await conn.sql.end();
    },
  };
}

/**
 * drizzle-kit qualifies foreign key targets with "public", so the generated
 * SQL is rewritten to the test schema and applied statement by statement
 * instead of going through the drizzle migrator.
 */
async function applyMigrationsTo(conn: Connection, schemaName: string): Promise<void> {
  const files = readdirSync(MIGRATIONS_FOLDER)
    .filter((f) => f.endsWith(".sql"))
    .sort();
  for (const file of files) {
    const text = readFileSync(path.join(MIGRATIONS_FOLDER, file), "utf8").replaceAll('"public".', `"${schemaName}".`);
    for (const statement of text.split("--> statement-breakpoint")) {
      const trimmed = statement.trim();
      if (trimmed) await conn.sql.unsafe(trimmed);
    }
  }
}

export type { Db };
