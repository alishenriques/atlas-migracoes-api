import { describe, expect, it, vi } from "vitest";
import type { Artist, FuzzyDate } from "../schemas/domain.js";
import { createTestApp } from "../test/helpers.js";
import { createResearchCache, pickMatch, researchArtist } from "./research.js";
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

type Routes = { search?: unknown; entities?: Record<string, unknown>; summary?: unknown; fail?: RegExp };

function fakeFetcher(routes: Routes) {
  return vi.fn<Fetcher>(async (url) => {
    if (routes.fail?.test(url)) return { ok: false, status: 503, json: async () => ({}) };
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

describe("researchArtist", () => {
  it("traces every finding to its source page and flags what needs review", async () => {
    const research = await researchArtist(artist(), fakeFetcher(found), now);

    expect(research.match).toEqual({
      id: "Q1340566",
      label: "Lasar Segall",
      description: "pintor lituano-brasileiro",
      url: "https://www.wikidata.org/wiki/Q1340566",
      basis: "birth_year",
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
    await researchArtist(artist(), fetcher, now);
    expect(fetcher.mock.calls.at(-1)?.[0]).toBe("https://en.wikipedia.org/api/rest_v1/page/summary/Lasar_Segall");

    const none = { ...segall, sitelinks: {} };
    const research = await researchArtist(artist(), fakeFetcher({ ...found, entities: { ...found.entities, Q1340566: none } }), now);
    expect(research.sources.at(-1)).toEqual({ source: "wikipedia", status: "no_match", detail: null });
  });

  it("returns no findings when no person is certainly the artist", async () => {
    const research = await researchArtist(artist({ birthDate: date(1700) }), fakeFetcher(found), now);
    expect(research).toEqual({
      match: null,
      findings: [],
      sources: [{ source: "wikidata", status: "no_match", detail: null }],
      retrievedAt: "2026-10-18T06:00:00.000Z",
    });
    const empty = await researchArtist(artist(), fakeFetcher({ search: { search: [] } }), now);
    expect(empty.match).toBeNull();
  });

  it("reports a source that fails instead of failing the whole research", async () => {
    const down = await researchArtist(artist(), fakeFetcher({ ...found, fail: /wbsearchentities/ }), now);
    expect(down.sources).toEqual([{ source: "wikidata", status: "error", detail: "www.wikidata.org answered 503" }]);

    const noLabels = await researchArtist(artist(), fakeFetcher({ ...found, fail: /props=labels&/ }), now);
    expect(noLabels.sources[0]).toEqual({ source: "wikidata", status: "error", detail: "labels: www.wikidata.org answered 503" });
    expect(noLabels.findings.find((finding) => finding.property === "birthPlace")?.value).toBe("Q216");

    const noWikipedia = await researchArtist(artist(), fakeFetcher({ ...found, fail: /wikipedia/ }), now);
    expect(noWikipedia.sources.at(-1)).toEqual({ source: "wikipedia", status: "error", detail: "pt.wikipedia.org answered 503" });

    const thrown = vi.fn<Fetcher>(async () => {
      throw "network down";
    });
    expect((await researchArtist(artist(), thrown, now)).sources[0]?.detail).toBe("network down");
  });
});

describe("createResearchCache", () => {
  it("asks the sources once per artist a day, and again after a failure", async () => {
    let clock = new Date("2026-10-18T06:00:00Z");
    const fetcher = fakeFetcher(found);
    const research = createResearchCache(fetcher, 60_000, () => clock);

    await research(artist());
    const calls = fetcher.mock.calls.length;
    await research(artist());
    expect(fetcher.mock.calls.length).toBe(calls);

    clock = new Date("2026-10-18T06:02:00Z");
    await research(artist());
    expect(fetcher.mock.calls.length).toBe(calls * 2);

    const failing = fakeFetcher({ fail: /./ });
    const flaky = createResearchCache(failing, 60_000, () => clock);
    await flaky(artist());
    await flaky(artist());
    expect(failing).toHaveBeenCalledTimes(2);
  });

  it("uses the real clock and a day's lifetime by default", async () => {
    const fetcher = fakeFetcher(found);
    const research = createResearchCache(fetcher);
    await research(artist());
    await research(artist());
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
