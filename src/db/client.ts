import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
import type { Env } from "../schemas/domain.js";
import * as schema from "./schema.js";

/** Driver-agnostic so tests can run against in-memory Postgres (PGlite). */
export type Database = PgDatabase<PgQueryResultHKT, typeof schema>;

export function createDatabase(env: Env): Database | null {
  if (!env.DATABASE_URL) {
    return null;
  }

  return drizzle(neon(env.DATABASE_URL), { schema });
}
