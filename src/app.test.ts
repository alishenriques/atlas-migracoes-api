import { describe, expect, it } from "vitest";
import { createApp } from "./app.js";
import { loadEnv } from "./schemas/domain.js";
import { createTestApp } from "./test/helpers.js";

describe("GraphQL app (demo mode, no database)", () => {
  const { gql } = createTestApp(null);

  it("answers the health query", async () => {
    expect(await gql("{ health }")).toEqual({ data: { health: "ok" } });
  });

  it("says the data is simulated", async () => {
    expect((await gql<{ meta: { source: string } }>("{ meta { source } }")).data?.meta.source).toBe("demo");
  });

  it("filters artists by origin country and by name", async () => {
    const byCountry = await gql<{ artists: { slug: string }[] }>(`{ artists(filter: { originCountry: "Áustria" }) { slug } }`);
    expect(byCountry.data?.artists).toEqual([{ slug: "artista-demo-b" }]);
    const bySearch = await gql<{ artists: { slug: string }[] }>(`{ artists(filter: { search: "demo á" }) { slug } }`);
    expect(bySearch.data?.artists).toEqual([{ slug: "artista-demo-a" }]);
  });

  it("resolves an artist with places, works and dates", async () => {
    const result = await gql<{
      artist: { birthPlace: { label: string }; birthDate: { precision: string }; works: { publications: { id: string }[] }[] };
    }>(`{ artist(slug: "artista-demo-a") { birthPlace { label } birthDate { precision } works { publications { id } } } }`);
    expect(result.data?.artist).toEqual({
      birthPlace: { label: "Varsóvia" },
      birthDate: { precision: "year" },
      works: [{ publications: [{ id: "DEMO.PB.1" }] }],
    });
  });

  it("returns null for an unknown artist and rejects an empty slug", async () => {
    expect((await gql(`{ artist(slug: "ninguem") { id } }`)).data).toEqual({ artist: null });
    const empty = await gql(`{ artist(slug: " ") { id } }`);
    expect(empty.errors?.[0]?.extensions?.code).toBe("BAD_USER_INPUT");
  });

  it("lists exhibitions of a place", async () => {
    const result = await gql<{ exhibitions: { works: { id: string }[] }[] }>(
      `{ exhibitions(placeId: "brasil-rio-de-janeiro-rio-de-janeiro") { works { id } } }`,
    );
    expect(result.data?.exhibitions[0]?.works.map((work) => work.id)).toEqual(["DEMO.1", "DEMO.2"]);
  });
});

describe("CORS", () => {
  const app = createApp(loadEnv({ NODE_ENV: "test", CORS_ORIGIN: "https://atlas.example,https://atlas-preview.example" }), {
    db: null,
  });

  async function preflight(origin: string) {
    return app.fetch("http://localhost/graphql", {
      method: "OPTIONS",
      headers: { origin, "access-control-request-method": "POST" },
    });
  }

  it("allows every configured origin", async () => {
    for (const origin of ["https://atlas.example", "https://atlas-preview.example"]) {
      expect((await preflight(origin)).headers.get("access-control-allow-origin")).toBe(origin);
    }
  });

  it("does not allow other origins", async () => {
    expect((await preflight("https://evil.example")).headers.get("access-control-allow-origin")).not.toBe(
      "https://evil.example",
    );
  });
});
