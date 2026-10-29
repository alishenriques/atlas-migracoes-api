import { describe, expect, it, vi } from "vitest";
import type { Artist, FuzzyDate } from "../schemas/domain.js";
import { createApp } from "../app.js";
import { loadEnv } from "../schemas/domain.js";
import { createTestApp, testEnv } from "../test/helpers.js";
import { candidatesOf, createResearchCache, pickMatch, researchArtist, searchNames, type ResearchDeps } from "./research.js";
import type { States } from "./territories.js";
import { claimsOf, getEntities, readValue, USER_AGENT, type Entity, type Fetcher } from "./wikimedia.js";

const date = (year: number | null, precision: FuzzyDate["precision"] = "year"): FuzzyDate => ({
  raw: year === null ? null : String(year),
  year,
  endYear: year,
  iso: null,
  precision: year === null ? "unknown" : precision,
});

const artist = (overrides: Partial<Artist> = {}): Artist => ({
  id: "a1",
  slug: "lasar-segall",
  name: "Lasar Segall",
  birthPlaceId: null,
  birthDate: date(1889),
  deathPlaceId: null,
  deathDate: date(1957),
  ...overrides,
});

const time = (iso: string, precision: number) => ({
  snaktype: "value",
  datavalue: { type: "time", value: { time: `+${iso}T00:00:00Z`, precision } },
});
const item = (id: string) => ({ snaktype: "value", datavalue: { type: "wikibase-entityid", value: { id } } });
const claim = (mainsnak: unknown, references = 0, rank = "normal") => ({
  mainsnak,
  rank,
  references: Array.from({ length: references }, () => ({})),
});

// Shaped like Wikidata's answer; the death date is deliberately off by a year to exercise the conflict flag.
const segall = {
  id: "Q1340566",
  labels: { pt: { value: "Lasar Segall" } },
  descriptions: { pt: { value: "pintor lituano-brasileiro" } },
  claims: {
    P31: [claim(item("Q5"))],
    P569: [claim(time("1889-07-21", 11), 2)],
    P19: [claim(item("Q216"), 1)],
    P570: [claim(time("1958-08-02", 11))],
    P106: [claim(item("Q1028181"), 0, "deprecated"), claim(item("Q1028181"), 1, "preferred"), claim(item("Q42"))],
    P135: [claim({ snaktype: "somevalue" })],
  },
  sitelinks: { ptwiki: { title: "Lasar Segall" }, enwiki: { title: "Lasar Segall" } },
};
const namesake = {
  id: "Q999",
  labels: { en: { value: "Lasar Segall" } },
  claims: { P31: [claim(item("Q5"))], P569: [claim(time("1950-00-00", 9))] },
};
const street = { id: "Q555", labels: { pt: { value: "Rua Lasar Segall" } }, claims: { P31: [claim(item("Q79007"))] } };
const labels = {
  Q216: { id: "Q216", labels: { pt: { value: "Vilnius" } } },
  Q1028181: { id: "Q1028181", labels: { en: { value: "painter" } } },
  Q42: { id: "Q42", labels: {} },
};

type Routes = {
  search?: unknown;
  entities?: Record<string, unknown>;
  summary?: unknown;
  /** The borders file and Gemini's answer. */
  states?: unknown;
  stateNames?: unknown;
  gemini?: unknown;
  fail?: RegExp;
};

function fakeFetcher(routes: Routes) {
  return vi.fn<Fetcher>(async (url) => {
    if (routes.fail?.test(url)) return { ok: false, status: 503, json: async () => ({}) };
    if (url.endsWith("state-names.json")) return { ok: true, status: 200, json: async () => routes.stateNames };
    if (url.includes("cartography")) return { ok: true, status: 200, json: async () => routes.states };
    if (url.includes("generativelanguage")) return { ok: true, status: 200, json: async () => routes.gemini };
    const parsed = new URL(url);
    const action = parsed.searchParams.get("action");
    if (action === "wbsearchentities") return { ok: true, status: 200, json: async () => routes.search };
    if (action === "wbgetentities") {
      const ids = (parsed.searchParams.get("ids") ?? "").split("|");
      const entities = Object.fromEntries(ids.map((id) => [id, routes.entities?.[id] ?? { id, missing: "" }]));
      return { ok: true, status: 200, json: async () => ({ entities }) };
    }
    return { ok: true, status: 200, json: async () => routes.summary };
  });
}

const found = {
  search: { search: [{ id: "Q1340566" }, { id: "Q999" }, { id: "Q555" }] },
  entities: { Q1340566: segall, Q999: namesake, Q555: street, ...labels },
  summary: {
    title: "Lasar Segall",
    extract: "Lasar Segall foi um pintor, escultor e gravador lituano naturalizado brasileiro.",
    content_urls: { desktop: { page: "https://pt.wikipedia.org/wiki/Lasar_Segall" } },
  },
};

const now = new Date("2026-10-18T06:00:00Z");

const noPlaces = { birth: null, death: null };
/** No Gemini key and no borders file, unless a test gives them. */
const deps = (fetcher: Fetcher, extra: Partial<ResearchDeps> = {}): ResearchDeps => ({
  fetcher,
  gemini: null,
  states: async () => null,
  ...extra,
});

describe("readValue", () => {
  it("keeps a date as precise as Wikidata gives it", () => {
    expect(readValue(time("1889-07-21", 11))).toEqual({ kind: "time", year: 1889, iso: "1889-07-21", precision: "day" });
    expect(readValue(time("1889-07-00", 10))).toEqual({ kind: "time", year: 1889, iso: "1889-07", precision: "month" });
    expect(readValue(time("1889-00-00", 9))).toEqual({ kind: "time", year: 1889, iso: "1889", precision: "year" });
    expect(readValue(time("1800-00-00", 7))).toMatchObject({ precision: "coarser", iso: "1800" });
    expect(readValue({ snaktype: "value", datavalue: { type: "time", value: { time: "-0500-00-00T00:00:00Z", precision: 9 } } })).toMatchObject({ year: -500 });
  });

  it("reads strings and items, and skips what the Atlas does not use", () => {
    expect(readValue({ snaktype: "value", datavalue: { type: "string", value: "x" } })).toEqual({ kind: "text", text: "x" });
    expect(readValue({ snaktype: "value", datavalue: { type: "string", value: 1 } })).toBeNull();
    expect(readValue({ snaktype: "value", datavalue: { type: "wikibase-entityid", value: {} } })).toBeNull();
    expect(readValue({ snaktype: "value", datavalue: { type: "time", value: { time: "1889" , precision: 9 } } })).toBeNull();
    expect(readValue({ snaktype: "value", datavalue: { type: "time", value: "1889" } })).toBeNull();
    expect(readValue({ snaktype: "value", datavalue: { type: "quantity", value: {} } })).toBeNull();
    expect(readValue({ snaktype: "novalue" })).toBeNull();
    expect(readValue({ snaktype: "value" })).toBeNull();
  });
});

describe("claimsOf", () => {
  it("keeps only the preferred statements when there are any, never deprecated ones", () => {
    expect(claimsOf(segall as unknown as Entity, "P106")).toEqual([
      { value: { kind: "item", id: "Q1028181" }, references: 1 },
    ]);
  });
});

describe("getEntities", () => {
  it("asks for at most 50 ids per request and leaves missing ones out", async () => {
    const fetcher = fakeFetcher({ entities: {} });
    const ids = Array.from({ length: 51 }, (_, index) => `Q${index}`);
    expect(await getEntities(fetcher, ids)).toEqual([]);
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(fetcher.mock.calls[0]?.[1].headers["User-Agent"]).toBe(USER_AGENT);
  });
});

describe("pickMatch", () => {
  const entities = [segall, namesake, street].map((entity) => ({ descriptions: {}, sitelinks: {}, ...entity })) as Entity[];

  it("takes the only person born in the collection's birth year", () => {
    expect(pickMatch(artist(), entities)).toMatchObject({ entity: { id: "Q1340566" }, basis: "birth_year" });
  });

  it("reads a circa birth year as two years either side", () => {
    expect(pickMatch(artist({ birthDate: date(1891, "circa") }), entities)?.entity.id).toBe("Q1340566");
    expect(pickMatch(artist({ birthDate: date(1892, "circa") }), entities)).toBeNull();
  });

  it("does not guess when nobody, or more than one person, fits", () => {
    expect(pickMatch(artist({ birthDate: date(1900) }), entities)).toBeNull();
    const twin = { ...entities[0], id: "Q2" } as Entity;
    expect(pickMatch(artist(), [...entities, twin])).toBeNull();
  });

  it("falls back to the exact name only when the collection has no birth year", () => {
    expect(pickMatch(artist({ birthDate: date(null) }), entities)).toBeNull();
    expect(pickMatch(artist({ birthDate: date(null), name: "Lasar  SEGALL" }), [entities[0] as Entity, entities[2] as Entity])).toMatchObject({
      entity: { id: "Q1340566" },
      basis: "name",
    });
  });
});

describe("searchNames", () => {
  it("adds first and last name only when the name has middle names", () => {
    expect(searchNames("Maciej Antoni Babinski")).toEqual(["Maciej Antoni Babinski", "Maciej Babinski"]);
    expect(searchNames("Lasar Segall")).toEqual(["Lasar Segall"]);
  });
});

describe("candidatesOf", () => {
  const entities = [segall, namesake, street].map((entity) => ({ descriptions: {}, sitelinks: {}, ...entity })) as Entity[];
  const by = (name: string) => new Map(entities.map((entity) => [entity.id, name]));

  it("says when several people fit, or one fits only under a shorter name", () => {
    const twin = { ...entities[0], id: "Q2" } as Entity;
    expect(candidatesOf(artist(), [entities[0] as Entity, twin], by("Lasar Segall")).map((c) => c.reason)).toEqual(["ambiguous", "ambiguous"]);
    expect(candidatesOf(artist({ name: "Lasar Ignacy Segall" }), entities, by("Lasar Segall"))[0]).toMatchObject({
      foundBy: "Lasar Segall",
      reason: "shorter_name",
    });
  });

  it("says when Wikidata has no birth year, or the collection has none and the name differs", () => {
    const undated = { ...entities[1], claims: { P31: segall.claims.P31 } } as Entity;
    expect(candidatesOf(artist(), [undated], by("Lasar Segall"))[0]).toMatchObject({ birthYear: null, reason: "no_birth_year" });
    expect(candidatesOf(artist({ birthDate: date(null), name: "Lasar Segal" }), entities, new Map())[0]).toMatchObject({
      foundBy: "Lasar Segal",
      reason: "name_differs",
    });
  });

  it("keeps at most five people", () => {
    const many = Array.from({ length: 7 }, (_, i) => ({ ...entities[1], id: `Q${i}` }) as Entity);
    expect(candidatesOf(artist(), many, new Map())).toHaveLength(5);
  });
});

describe("researchArtist", () => {
  it("traces every finding to its source page and flags what needs review", async () => {
    const research = await researchArtist(artist(), noPlaces, deps(fakeFetcher(found)), now);

    expect(research.match).toEqual({
      id: "Q1340566",
      label: "Lasar Segall",
      description: "pintor lituano-brasileiro",
      url: "https://www.wikidata.org/wiki/Q1340566",
      basis: "birth_year",
      note: null,
    });
    expect(research.sources).toEqual([
      { source: "wikidata", status: "ok", detail: null },
      { source: "wikipedia", status: "ok", detail: null },
    ]);
    expect(research.retrievedAt).toBe("2026-10-18T06:00:00.000Z");
    expect(research.findings.map(({ property, value, reliability, reviews }) => ({ property, value, reliability, reviews }))).toEqual([
      { property: "birthDate", value: "1889-07-21", reliability: "documented", reviews: [] },
      { property: "birthPlace", value: "Vilnius", reliability: "documented", reviews: ["present_day_name"] },
      { property: "deathDate", value: "1958-08-02", reliability: "undetermined", reviews: ["conflicts_with_collection"] },
      { property: "occupation", value: "painter", reliability: "documented", reviews: [] },
      {
        property: "summary",
        value: "Lasar Segall foi um pintor, escultor e gravador lituano naturalizado brasileiro.",
        reliability: "undetermined",
        reviews: [],
      },
    ]);
    expect(research.findings[0]).toMatchObject({
      source: "wikidata",
      sourceUrl: "https://www.wikidata.org/wiki/Q1340566",
      sourceTitle: "Wikidata: Lasar Segall (Q1340566)",
      propertyId: "P569",
      references: 2,
    });
    expect(research.findings.at(-1)).toMatchObject({
      source: "wikipedia",
      sourceUrl: "https://pt.wikipedia.org/wiki/Lasar_Segall",
      sourceTitle: "Wikipedia (pt): Lasar Segall",
      propertyId: null,
    });
  });

  it("reads the English article when there is no Portuguese one, and says when there is none", async () => {
    const english = { ...segall, sitelinks: { enwiki: { title: "Lasar Segall" } } };
    const fetcher = fakeFetcher({ ...found, entities: { ...found.entities, Q1340566: english } });
    await researchArtist(artist(), noPlaces, deps(fetcher), now);
    expect(fetcher.mock.calls.at(-1)?.[0]).toBe("https://en.wikipedia.org/api/rest_v1/page/summary/Lasar_Segall");

    const none = { ...segall, sitelinks: {} };
    const research = await researchArtist(artist(), noPlaces, deps(fakeFetcher({ ...found, entities: { ...found.entities, Q1340566: none } })), now);
    expect(research.sources.at(-1)).toEqual({ source: "wikipedia", status: "no_match", detail: null });
  });

  it("returns no findings when no person is certainly the artist", async () => {
    const research = await researchArtist(artist({ birthDate: date(1700) }), noPlaces, deps(fakeFetcher(found)), now);
    expect(research).toEqual({
      searchedNames: ["Lasar Segall"],
      match: null,
      candidates: [
        {
          id: "Q1340566",
          label: "Lasar Segall",
          description: "pintor lituano-brasileiro",
          url: "https://www.wikidata.org/wiki/Q1340566",
          birthYear: 1889,
          foundBy: "Lasar Segall",
          reason: "birth_year_differs",
        },
        { id: "Q999", label: "Lasar Segall", description: null, url: "https://www.wikidata.org/wiki/Q999", birthYear: 1950, foundBy: "Lasar Segall", reason: "birth_year_differs" },
      ],
      findings: [],
      sources: [{ source: "wikidata", status: "no_match", detail: null }],
      period: null,
      summary: { status: "no_findings", text: null, citations: [], prompt: null, model: null, detail: null },
      retrievedAt: "2026-10-18T06:00:00.000Z",
    });
    const empty = await researchArtist(artist(), noPlaces, deps(fakeFetcher({ search: { search: [] } })), now);
    expect(empty.match).toBeNull();
    expect(empty.candidates).toEqual([]);
  });

  it("searches a shorter name too, but never links the person it finds", async () => {
    // Wikidata knows him only as "Lasar Segall".
    const known = fakeFetcher(found);
    const fetcher = vi.fn<Fetcher>(async (url, init) =>
      new URL(url).searchParams.get("search") === "Lasar Ignacy Segall"
        ? { ok: true, status: 200, json: async () => ({ search: [] }) }
        : known(url, init),
    );
    const research = await researchArtist(artist({ name: "Lasar Ignacy Segall" }), noPlaces, deps(fetcher), now);
    const searched = fetcher.mock.calls.map(([url]) => new URL(url).searchParams.get("search")).filter(Boolean);
    expect(searched).toEqual(["Lasar Ignacy Segall", "Lasar Segall"]);
    expect(research.searchedNames).toEqual(["Lasar Ignacy Segall", "Lasar Segall"]);
    expect(research.match).toBeNull();
    expect(research.candidates[0]).toMatchObject({ id: "Q1340566", foundBy: "Lasar Segall", reason: "shorter_name" });
  });

  it("uses a reviewed link without searching, with the researcher's note", async () => {
    const fetcher = fakeFetcher(found);
    const link = { confirmed: "Q1340566", rejected: [], note: "Conferido pela data de nascimento." };
    const research = await researchArtist(artist({ birthDate: date(1700) }), noPlaces, deps(fetcher, { links: () => link }), now);
    expect(fetcher.mock.calls.some(([url]) => url.includes("wbsearchentities"))).toBe(false);
    expect(research.searchedNames).toEqual([]);
    expect(research.match).toMatchObject({ id: "Q1340566", basis: "reviewed", note: "Conferido pela data de nascimento." });
    expect(research.candidates).toEqual([]);
    expect(research.findings.length).toBeGreaterThan(0);
  });

  it("reports a reviewed item Wikidata no longer has", async () => {
    const link = { confirmed: "Q7", rejected: [], note: null };
    const research = await researchArtist(artist(), noPlaces, deps(fakeFetcher(found), { links: () => link }), now);
    expect(research.match).toBeNull();
    expect(research.sources).toEqual([{ source: "wikidata", status: "error", detail: "reviewed item Q7 not found" }]);
  });

  it("never matches nor offers a rejected item", async () => {
    const link = { confirmed: null, rejected: ["Q1340566"], note: null };
    const research = await researchArtist(artist(), noPlaces, deps(fakeFetcher(found), { links: () => link }), now);
    expect(research.searchedNames).toEqual(["Lasar Segall"]);
    expect(research.match).toBeNull();
    expect(research.candidates.map((candidate) => candidate.id)).toEqual(["Q999"]);
  });

  it("reports a source that fails instead of failing the whole research", async () => {
    const down = await researchArtist(artist(), noPlaces, deps(fakeFetcher({ ...found, fail: /wbsearchentities/ })), now);
    expect(down.sources).toEqual([{ source: "wikidata", status: "error", detail: "www.wikidata.org answered 503" }]);

    const noLabels = await researchArtist(artist(), noPlaces, deps(fakeFetcher({ ...found, fail: /props=labels&/ })), now);
    expect(noLabels.sources[0]).toEqual({ source: "wikidata", status: "error", detail: "labels: www.wikidata.org answered 503" });
    expect(noLabels.findings.find((finding) => finding.property === "birthPlace")?.value).toBe("Q216");

    const noWikipedia = await researchArtist(artist(), noPlaces, deps(fakeFetcher({ ...found, fail: /wikipedia/ })), now);
    expect(noWikipedia.sources.at(-1)).toEqual({ source: "wikipedia", status: "error", detail: "pt.wikipedia.org answered 503" });

    const thrown = vi.fn<Fetcher>(async () => {
      throw "network down";
    });
    expect((await researchArtist(artist(), noPlaces, deps(thrown), now)).sources[0]?.detail).toBe("network down");
  });
});

// Warsaw in 1905 lay in the Russian Empire: a square around it is enough here.
const russianStates: States = {
  features: [
    {
      properties: { name: "Russia (Soviet Union)", start: "1886-01-01", end: "1917-12-31" },
      geometry: { type: "Polygon", coordinates: [[[15, 45], [40, 45], [40, 60], [15, 60], [15, 45]]] },
    },
  ],
  names: { "Russia (Soviet Union)": [{ until: "1917-03-15", pt: "Império Russo" }, { pt: "Rússia Soviética" }] },
};
const { names: russianNames, ...russianBorders } = russianStates;
const russianEmpire = { type: "FeatureCollection", ...russianBorders };
const answer = (text: string) => ({ candidates: [{ content: { parts: [{ text }] } }], modelVersion: "gemini-test" });

describe("researchArtist with the period's map and the model", () => {
  const warsaw = { id: "w", label: "Varsóvia", path: ["Polônia", "Varsóvia"], country: "Polônia", currentName: null, lat: 52.2, lng: 21 };

  it("reads the map at the artist's birth and summarises the findings within it", async () => {
    const fetcher = fakeFetcher({ ...found, gemini: answer("Nasceu em 1889 [1].") });
    const states = vi.fn(async () => russianStates);
    const research = await researchArtist(
      artist(),
      { birth: warsaw, death: null },
      deps(fetcher, { states, gemini: { apiKey: "k", model: "m" } }),
      now,
    );
    expect(research.period).toMatchObject({ day: "1889-07-01", birthState: "Império Russo", states: ["Império Russo"] });
    expect(research.summary).toMatchObject({ status: "ok", text: "Nasceu em 1889 [1].", citations: [1], model: "gemini-test" });
    expect(research.summary.prompt).toContain("Estado que continha o local de nascimento nesse dia: Império Russo.");
  });
});

describe("createResearchCache", () => {
  it("asks the sources once per artist a day, and a failure again only after a short wait", async () => {
    let clock = new Date("2026-10-18T06:00:00Z");
    const fetcher = fakeFetcher(found);
    const research = createResearchCache(deps(fetcher), 60_000, () => clock);

    await research(artist(), noPlaces);
    const calls = fetcher.mock.calls.length;
    await research(artist(), noPlaces);
    expect(fetcher.mock.calls.length).toBe(calls);

    clock = new Date("2026-10-18T06:02:00Z");
    await research(artist(), noPlaces);
    expect(fetcher.mock.calls.length).toBe(calls * 2);

    const failing = fakeFetcher({ fail: /./ });
    const flaky = createResearchCache(deps(failing), 60_000, () => clock, 10_000);
    await flaky(artist(), noPlaces);
    await flaky(artist(), noPlaces);
    const failedCalls = failing.mock.calls.length;
    clock = new Date("2026-10-18T06:02:11Z");
    await flaky(artist(), noPlaces);
    expect(failing.mock.calls.length).toBe(failedCalls * 2);
  });

  it("keeps a failed summary for a short while instead of asking on every view", async () => {
    const fetcher = fakeFetcher({ ...found, fail: /generativelanguage/ });
    const research = createResearchCache(deps(fetcher, { gemini: { apiKey: "k", model: "m" } }));
    expect((await research(artist(), noPlaces)).summary.status).toBe("error");
    await research(artist(), noPlaces);
    expect(fetcher.mock.calls.filter(([url]) => url.includes("generativelanguage"))).toHaveLength(1);
  });

  it("uses the real clock and a day's lifetime by default", async () => {
    const fetcher = fakeFetcher(found);
    const research = createResearchCache(deps(fetcher));
    await research(artist(), noPlaces);
    await research(artist(), noPlaces);
    expect(fetcher.mock.calls.filter(([url]) => url.includes("wbsearchentities"))).toHaveLength(1);
  });
});

describe("research query", () => {
  it("answers with the artist and the traced findings", async () => {
    const { gql } = createTestApp(null, fakeFetcher({ ...found, search: { search: [] } }));
    const result = await gql<{ research: { artist: { slug: string }; match: null; sources: { status: string }[] } }>(
      `{ research(slug: "artista-demo-a") { artist { slug } match { id } sources { status } findings { value } } }`,
    );
    expect(result.data?.research).toEqual({ artist: { slug: "artista-demo-a" }, match: null, sources: [{ status: "no_match" }], findings: [] });
  });

  it("gives the period's map and the summary with its prompt", async () => {
    const fetcher = fakeFetcher({ ...found, search: { search: [] }, states: russianEmpire, stateNames: russianNames });
    const { gql } = createTestApp(null, fetcher);
    const result = await gql<{ research: { period: unknown; summary: { status: string; prompt: string | null } } }>(
      `{ research(slug: "artista-demo-a") { period { day approximate birthState states } summary { status text citations prompt model detail } } }`,
    );
    expect(result.data?.research.period).toEqual({
      day: "1905-07-01",
      approximate: false,
      birthState: "Império Russo",
      states: ["Império Russo"],
    });
    expect(result.data?.research.summary).toMatchObject({ status: "no_findings", prompt: null });
    expect(fetcher.mock.calls.some(([url]) => url === testEnv.CARTOGRAPHY_URL)).toBe(true);
  });

  it("asks Gemini live only with a key and GEMINI_LIVE=true", async () => {
    const fetcher = fakeFetcher({ ...found, entities: { ...found.entities, Q1340566: { ...segall, claims: { ...segall.claims, P569: [claim(time("1905-01-01", 9))] } } }, gemini: answer("Pintor [1].") });
    const summaryWith = async (env: Record<string, string>) => {
      const app = createApp(loadEnv({ NODE_ENV: "test", ...env }), { db: null, fetcher });
      const response = await app.fetch("http://localhost/graphql", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ query: `{ research(slug: "artista-demo-a") { summary { status text } } }` }),
      });
      return ((await response.json()) as { data: { research: { summary: unknown } } }).data.research.summary;
    };
    expect(await summaryWith({ GEMINI_API_KEY: "k" })).toEqual({ status: "not_configured", text: null });
    expect(fetcher.mock.calls.some(([url]) => url.includes("generativelanguage"))).toBe(false);
    expect(await summaryWith({ GEMINI_API_KEY: "k", GEMINI_LIVE: "true" })).toEqual({ status: "ok", text: "Pintor [1]." });
  });

  it("returns null for an unknown artist", async () => {
    const { gql } = createTestApp(null);
    expect((await gql(`{ research(slug: "ninguem") { retrievedAt } }`)).data).toEqual({ research: null });
  });

  it("stays offline in tests by default", async () => {
    const { gql } = createTestApp(null);
    const result = await gql<{ research: { sources: { status: string; detail: string }[] } }>(
      `{ research(slug: "artista-demo-a") { sources { status detail } } }`,
    );
    expect(result.data?.research.sources[0]?.status).toBe("error");
  });
});
