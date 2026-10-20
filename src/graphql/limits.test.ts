import { describe, expect, it } from "vitest";
import { createApp } from "../app.js";
import { loadEnv } from "../schemas/domain.js";
import { appOperations } from "../test/appOperations.js";
import { createTestApp } from "../test/helpers.js";
import { QUERY_LIMITS } from "./limits.js";

// Under Vitest, graphql-armor's errors come from a second copy of `graphql`, so
// Yoga masks their text ("Unexpected error."); the real server shows it, e.g.
// "Syntax Error: Aliases limit of 10 exceeded, found 11.". The tests check that
// the request is refused, not the wording.
describe("query limits", () => {
  const { gql } = createTestApp(null);

  it.each(Object.entries(appOperations))("accept the app's %s operation", async (_, query) => {
    const result = await gql(query, { slug: "artista-demo-a" });
    expect(result.errors).toBeUndefined();
  });

  it("reject a deeply nested query", async () => {
    const nested = (level: number): string =>
      level === 0 ? "id" : `works { exhibitions { works { artist { ${nested(level - 1)} } } } }`;
    expect((await gql(`{ artists { ${nested(1)} } }`)).errors).toBeUndefined();
    const result = await gql(`{ artists { ${nested(QUERY_LIMITS.maxDepth)} } }`);
    expect(result.data).toBeUndefined();
    expect(result.errors).toHaveLength(1);
  });

  it("reject more aliases than the limit", async () => {
    const aliases = (count: number) => Array.from({ length: count }, (_, i) => `a${i}: health`).join(" ");
    expect((await gql(`{ ${aliases(QUERY_LIMITS.maxAliases)} }`)).errors).toBeUndefined();
    const result = await gql(`{ ${aliases(QUERY_LIMITS.maxAliases + 1)} }`);
    expect(result.data).toBeUndefined();
    expect(result.errors).toHaveLength(1);
  });

  it("reject asking for more than one artist's research in one request", async () => {
    const byAlias = await gql(`{ a: research(slug: "artista-demo-a") { retrievedAt } b: research(slug: "artista-demo-b") { retrievedAt } }`);
    expect(byAlias.errors?.[0]?.extensions?.code).toBe("BAD_USER_INPUT");

    const byFragments = await gql(`
      query { ...A ...B }
      fragment A on Query { a: research(slug: "artista-demo-a") { retrievedAt } }
      fragment B on Query { b: research(slug: "artista-demo-b") { retrievedAt } }
    `);
    expect(byFragments.errors?.[0]?.message).toBe("Ask for one artist's research per request.");
  });

  it("accept the same research field spread twice, which runs once", async () => {
    const result = await gql(`
      query { research(slug: "artista-demo-a") { retrievedAt } ...A }
      fragment A on Query { research(slug: "artista-demo-a") { retrievedAt } }
    `);
    expect(result.errors).toBeUndefined();
  });
});

describe("GraphiQL", () => {
  const page = (NODE_ENV: "development" | "production") =>
    createApp(loadEnv({ NODE_ENV }), { db: null }).fetch("http://localhost/graphql", { headers: { accept: "text/html" } });

  it("is served in development only", async () => {
    expect((await (await page("development")).text()).toLowerCase()).toContain("graphiql");
    expect((await (await page("production")).text()).toLowerCase()).not.toContain("graphiql");
  });
});
