/**
 * The database handle. One postgres.js pool per process, kept on globalThis
 * so Turbopack's per-route module instances in dev share it. Services take
 * a Db (or a transaction) as their first argument so tests can hand them an
 * isolated schema.
 */

import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

export { schema };

export type Db = PostgresJsDatabase<typeof schema>;
/** A Db or the transaction handle inside db.transaction(). */
export type DbOrTx = Db | Parameters<Parameters<Db["transaction"]>[0]>[0];

export const DEFAULT_DATABASE_URL = "postgres://gotcha:gotcha@localhost:5434/gotcha";

/** Reads .env once when DATABASE_URL is not already set (vitest and scripts; Next loads it itself). */
export function loadDotEnv(): void {
  if (process.env.DATABASE_URL) return;
  try {
    process.loadEnvFile?.(".env");
  } catch {
    // No .env, use the defaults.
  }
}

export function databaseUrl(): string {
  loadDotEnv();
  return process.env.DATABASE_URL ?? DEFAULT_DATABASE_URL;
}

export interface Connection {
  sql: postgres.Sql;
  db: Db;
}

/** A new pool. Callers own it and must call sql.end(). */
export function connect(url = databaseUrl(), options: postgres.Options<Record<string, never>> = {}): Connection {
  const sql = postgres(url, { max: 10, onnotice: () => {}, ...options });
  const db = drizzle(sql, { schema });
  return { sql, db };
}

const KEY = Symbol.for("gotcha.db");
type Holder = { [KEY]?: Connection };

export function getDb(): Db {
  const holder = globalThis as Holder;
  holder[KEY] ??= connect();
  return holder[KEY].db;
}

export function getSql(): postgres.Sql {
  const holder = globalThis as Holder;
  holder[KEY] ??= connect();
  return holder[KEY].sql;
}

export async function closeDb(): Promise<void> {
  const holder = globalThis as Holder;
  const conn = holder[KEY];
  if (!conn) return;
  delete holder[KEY];
  await conn.sql.end();
}
