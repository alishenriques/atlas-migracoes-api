import "dotenv/config";
import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import { migrate } from "drizzle-orm/neon-http/migrator";
import { loadEnv } from "../schemas/domain.js";

const { DATABASE_URL } = loadEnv();

if (!DATABASE_URL) {
  throw new Error("DATABASE_URL is required to run migrations");
}

await migrate(drizzle(neon(DATABASE_URL)), { migrationsFolder: "./drizzle" });
console.log("Migrations applied");
