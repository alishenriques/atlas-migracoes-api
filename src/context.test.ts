import { describe, expect, it, vi } from "vitest";
import { createContext } from "./context.js";
import type { Database } from "./db/client.js";
import { createTestDatabase, testEnv } from "./test/helpers.js";

const noResearch = () => Promise.reject(new Error("not used"));

describe("createContext", () => {
  it("serves the simulated records without a database", async () => {
    const context = createContext(testEnv, null, noResearch)();
    expect(context.source).toBe("demo");
    expect((await context.data()).dataset.artists.length).toBeGreaterThan(0);
  });

  it("reads the base once per instance until the cache expires", async () => {
    const db = await createTestDatabase();
    const select = vi.spyOn(db, "select");
    let now = 0;
    const context = createContext(testEnv, db, noResearch, 1000, () => now);

    await context().data();
    await context().data();
    const reads = select.mock.calls.length;
    expect(reads).toBe(7);

    now = 1000;
    await context().data();
    expect(select.mock.calls.length).toBe(reads * 2);
  });

  it("does not keep a failed load", async () => {
    let attempts = 0;
    const broken = {
      select: () => {
        attempts += 1;
        throw new Error("database down");
      },
    } as unknown as Database;
    const context = createContext(testEnv, broken, noResearch);

    await expect(context().data()).rejects.toThrow("database down");
    await expect(context().data()).rejects.toThrow("database down");
    expect(attempts).toBe(2);
  });
});
