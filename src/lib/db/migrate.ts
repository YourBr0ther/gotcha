/**
 * Runs the SQL migrations in drizzle/ against DATABASE_URL. Idempotent:
 * drizzle records applied migrations and skips them next time. The pod runs
 * this on start; `pnpm db:migrate` runs it locally.
 */

import path from "node:path";
import { fileURLToPath } from "node:url";
import { migrate as drizzleMigrate } from "drizzle-orm/postgres-js/migrator";
import { connect, type Db } from "./index";

export const MIGRATIONS_FOLDER = path.resolve(process.cwd(), "drizzle");

export interface MigrateOptions {
  migrationsFolder?: string;
  /** Where drizzle keeps its applied-migrations table. Tests point it at their own schema. */
  migrationsSchema?: string;
}

export async function runMigrations(db: Db, options: MigrateOptions = {}): Promise<void> {
  await drizzleMigrate(db, {
    migrationsFolder: options.migrationsFolder ?? MIGRATIONS_FOLDER,
    migrationsSchema: options.migrationsSchema ?? "drizzle",
  });
}

async function main() {
  const { sql, db } = connect();
  try {
    await runMigrations(db);
    console.log("migrations applied");
  } finally {
    await sql.end();
  }
}

const invokedDirectly = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
