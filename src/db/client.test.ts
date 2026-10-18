import { describe, expect, it } from "vitest";
import { loadEnv } from "../schemas/domain.js";
import { createDatabase } from "./client.js";

describe("createDatabase", () => {
  it("returns null without DATABASE_URL, so the API serves demo data", () => {
    expect(createDatabase(loadEnv({ NODE_ENV: "test" }))).toBeNull();
  });

  it("builds a Drizzle client for Neon without connecting yet", () => {
    const env = loadEnv({ NODE_ENV: "test", DATABASE_URL: "postgresql://user:pass@example.neon.tech/atlas" });
    expect(createDatabase(env)).toHaveProperty("select");
  });
});
