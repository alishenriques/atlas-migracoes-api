import { describe, expect, it, vi } from "vitest";
import { indexDataset, loadDataset } from "../db/dataset.js";
import { artists, researchResults } from "../db/schema.js";
import type { Artist, FuzzyDate } from "../schemas/domain.js";
import { createTestApp, createTestDatabase } from "../test/helpers.js";
import { createResearchCache, type Research, type ResearchDeps } from "./research.js";
import { generateResearch, linkOutdated, storedResearch } from "./stored.js";
import type { States } from "./territories.js";
import type { Fetcher } from "./wikimedia.js";

const unknownDate: FuzzyDate = { raw: null, year: null, endYear: null, iso: null, precision: "unknown" };
const artist = (slug: string): Artist => ({
  id: `id-${slug}`,
  slug,
  name: `Artista ${slug}`,
  birthPlaceId: null,
  birthDate: unknownDate,
  deathPlaceId: null,
  deathDate: unknownDate,
});

/** Wikidata finds nobody, so a research completes without findings; `fail` makes Wikidata fail instead. */
function sources(fail = false) {
  return vi.fn<Fetcher>(async (url) => {
    if (fail) return { ok: false, status: 503, json: async () => ({}) };
    if (url.includes("wbsearchentities")) return { ok: true, status: 200, json: async () => ({ search: [] }) };
    return { ok: false, status: 404, json: async () => ({}) };
  });
}
const deps = (fetcher: Fetcher): ResearchDeps => ({ fetcher, gemini: null, states: async () => null });

async function seeded(...slugs: string[]) {
  const db = await createTestDatabase();
  if (slugs.length > 0) await db.insert(artists).values(slugs.map(artist));
  return { db, data: indexDataset(await loadDataset(db)) };
}

/** A research whose only failure is the summary, with Gemini's error. */
const geminiError = (detail: string): Research => ({
  searchedNames: ["Artista"],
  match: null,
  candidates: [],
  findings: [],
  sources: [{ source: "wikidata", status: "ok", detail: null }],
  period: null,
  summary: { status: "error", text: null, citations: [], prompt: null, model: null, detail },
  retrievedAt: "2026-11-01T12:00:00.000Z",
});

const noWait = { sleep: async () => {}, clock: () => new Date("2026-11-01T12:00:00Z") };

describe("generateResearch", () => {
  it("stores each complete result and skips the stored ones on the next run", async () => {
    const { db, data } = await seeded("a", "b");
    const sleep = vi.fn(async () => {});
    expect(await generateResearch(db, data, deps(sources()), { ...noWait, sleep, delayMs: 10 })).toEqual([
      { slug: "a", outcome: "stored", detail: "summary: no_findings" },
      { slug: "b", outcome: "stored", detail: "summary: no_findings" },
    ]);
    expect(sleep).toHaveBeenCalledExactlyOnceWith(10);

    const stored = await storedResearch(db)(artist("a"));
    expect(stored?.retrievedAt).toBe("2026-11-01T12:00:00.000Z");
    expect(stored?.sources[0]?.status).toBe("no_match");

    const again = sources();
    expect((await generateResearch(db, data, deps(again), noWait)).map((o) => o.outcome)).toEqual(["kept", "kept"]);
    expect(again).not.toHaveBeenCalled();
  });

  it("asks again when forced, only for the slugs given", async () => {
    const { db, data } = await seeded("a", "b");
    await generateResearch(db, data, deps(sources()), noWait);
    const outcomes = await generateResearch(db, data, deps(sources()), { ...noWait, force: true, slugs: ["b"] });
    expect(outcomes).toEqual([{ slug: "b", outcome: "stored", detail: "summary: no_findings" }]);
    expect(await db.select().from(researchResults)).toHaveLength(2);
  });

  it("asks again only for results whose period's map changed, when asked to", async () => {
    const { db } = await seeded("a");
    const born1891: FuzzyDate = { raw: "1891", year: 1891, endYear: 1891, iso: null, precision: "year" };
    await db.insert(artists).values({ ...artist("b"), birthDate: born1891 });
    const data = indexDataset(await loadDataset(db));
    const russia = { name: "Russia (Soviet Union)", start: "1886-01-01", end: "1917-12-31" };
    const borders = [{ properties: russia, geometry: { type: "Polygon" as const, coordinates: [] } }];
    const withNames = (names: States["names"]): ResearchDeps => ({
      ...deps(sources()),
      states: async () => ({ features: borders, names }),
    });
    await generateResearch(db, data, withNames({}), noWait);
    expect((await storedResearch(db)(artist("b")))?.period?.states).toEqual(["Russia (Soviet Union)"]);

    const renamed = withNames({
      "Russia (Soviet Union)": [{ until: "1917-03-15", pt: "Império Russo" }, { pt: "Rússia Soviética" }],
    });
    const stale = { ...noWait, stalePeriod: true };
    expect(await generateResearch(db, data, renamed, stale)).toEqual([
      { slug: "a", outcome: "kept", detail: "period unchanged" },
      { slug: "b", outcome: "stored", detail: "summary: no_findings" },
    ]);
    expect((await storedResearch(db)(artist("b")))?.period?.states).toEqual(["Império Russo"]);
    expect((await generateResearch(db, data, renamed, stale)).map((o) => o.outcome)).toEqual(["kept", "kept"]);

    await expect(generateResearch(db, data, deps(sources()), stale)).rejects.toThrow("period's map");
  });

  it("reports an incomplete result and does not store it", async () => {
    const { db, data } = await seeded("a");
    const [outcome] = await generateResearch(db, data, deps(sources(true)), noWait);
    expect(outcome).toMatchObject({ slug: "a", outcome: "failed" });
    expect(outcome?.detail).toMatch(/^wikidata: /);
    expect(await storedResearch(db)(artist("a"))).toBeNull();
  });

  it("names the summary when only the summary failed", async () => {
    const { db, data } = await seeded("a");
    const research = vi.spyOn(await import("./research.js"), "researchArtist");
    research.mockResolvedValueOnce({
      searchedNames: ["Artista a"],
      match: null,
      candidates: [],
      findings: [],
      sources: [{ source: "wikidata", status: "ok", detail: null }],
      period: null,
      summary: { status: "error", text: null, citations: [], prompt: null, model: null, detail: null },
      retrievedAt: "2026-11-01T12:00:00.000Z",
    });
    const [outcome] = await generateResearch(db, data, deps(sources()), { ...noWait, retries: 0 });
    expect(outcome).toEqual({ slug: "a", outcome: "failed", detail: "summary: error" });
    research.mockRestore();
  });

  it("tries a failed artist again after longer and longer waits", async () => {
    const { db, data } = await seeded("a");
    const sleep = vi.fn(async () => {});
    const fetcher = sources(true);
    const [outcome] = await generateResearch(db, data, deps(fetcher), { ...noWait, sleep, retries: 2, retryDelayMs: 100 });
    expect(outcome?.outcome).toBe("failed");
    expect(sleep.mock.calls).toEqual([[100], [200]]);
    expect(fetcher).toHaveBeenCalledTimes(3);
  });

  it("does not try again when Gemini's quota is spent", async () => {
    const { db, data } = await seeded("a");
    const sleep = vi.fn(async () => {});
    const research = vi.spyOn(await import("./research.js"), "researchArtist");
    research.mockResolvedValue({
      searchedNames: ["Artista a"],
      match: null,
      candidates: [],
      findings: [],
      sources: [{ source: "wikidata", status: "ok", detail: null }],
      period: null,
      summary: { status: "error", text: null, citations: [], prompt: null, model: null, detail: "Gemini answered 429" },
      retrievedAt: "2026-11-01T12:00:00.000Z",
    });
    const [outcome] = await generateResearch(db, data, deps(sources()), { ...noWait, sleep, retries: 2 });
    expect(outcome).toEqual({ slug: "a", outcome: "failed", detail: "summary: Gemini answered 429" });
    expect(research).toHaveBeenCalledOnce();
    expect(sleep).not.toHaveBeenCalled();
    research.mockRestore();
  });

  it("stops asking Gemini for the rest of the run once its daily quota is spent", async () => {
    const { db, data } = await seeded("a", "b");
    const research = vi.spyOn(await import("./research.js"), "researchArtist");
    research.mockResolvedValue(geminiError("Gemini answered 429 (GenerateRequestsPerDayPerProjectPerModel-FreeTier)"));
    expect(await generateResearch(db, data, deps(sources()), noWait)).toEqual([
      { slug: "a", outcome: "failed", detail: "summary: Gemini answered 429 (GenerateRequestsPerDayPerProjectPerModel-FreeTier)" },
      { slug: "b", outcome: "skipped", detail: "Gemini's daily quota is spent" },
    ]);
    expect(research).toHaveBeenCalledOnce();
    research.mockRestore();
  });

  it("waits out a per-minute 429 and tries again", async () => {
    const { db, data } = await seeded("a");
    const research = vi.spyOn(await import("./research.js"), "researchArtist");
    research.mockResolvedValue(geminiError("Gemini answered 429 (GenerateRequestsPerMinutePerProjectPerModel-FreeTier)"));
    const [outcome] = await generateResearch(db, data, deps(sources()), { ...noWait, retries: 1 });
    expect(outcome?.outcome).toBe("failed");
    expect(research).toHaveBeenCalledTimes(2);
    research.mockRestore();
  });

  it("makes at most `limit` Gemini calls, retries included, and skips the rest", async () => {
    const { db, data } = await seeded("a", "b", "c");
    const research = vi.spyOn(await import("./research.js"), "researchArtist");
    research.mockResolvedValue(geminiError("Gemini answered 503"));
    expect(await generateResearch(db, data, deps(sources()), { ...noWait, retries: 2, limit: 2 })).toEqual([
      { slug: "a", outcome: "failed", detail: "summary: Gemini answered 503" },
      { slug: "b", outcome: "skipped", detail: "limit of 2 Gemini calls reached" },
      { slug: "c", outcome: "skipped", detail: "limit of 2 Gemini calls reached" },
    ]);
    expect(research).toHaveBeenCalledTimes(2);
    research.mockRestore();
  });

  it("stores the result once a retry succeeds", async () => {
    const { db, data } = await seeded("a");
    let calls = 0;
    const fetcher = vi.fn<Fetcher>(async (url) => {
      calls += 1;
      if (calls === 1) return { ok: false, status: 503, json: async () => ({}) };
      if (url.includes("wbsearchentities")) return { ok: true, status: 200, json: async () => ({ search: [] }) };
      return { ok: false, status: 404, json: async () => ({}) };
    });
    expect(await generateResearch(db, data, deps(fetcher), noWait)).toEqual([
      { slug: "a", outcome: "stored", detail: "summary: no_findings" },
    ]);
    expect(await storedResearch(db)(artist("a"))).not.toBeNull();
  });

  it("waits between live calls with the real timer by default", async () => {
    vi.useFakeTimers();
    const { db, data } = await seeded("a", "b");
    const run = generateResearch(db, data, deps(sources()), { delayMs: 1000 });
    await vi.runAllTimersAsync();
    expect((await run).map((o) => o.outcome)).toEqual(["stored", "stored"]);
    vi.useRealTimers();
  });
});

describe("research with stored results", () => {
  const research = (overrides: Partial<Research> = {}): Research => ({
    searchedNames: [],
    match: null,
    candidates: [],
    findings: [],
    sources: [],
    period: null,
    summary: { status: "no_findings", text: null, citations: [], prompt: null, model: null, detail: null },
    retrievedAt: "2026-11-01T12:00:00.000Z",
    ...overrides,
  });
  const noPlaces = { birth: null, death: null };

  it("uses the stored result and asks live only for artists without one", async () => {
    const fetcher = sources();
    const stored = vi.fn(async (a: Artist) => (a.slug === "a" ? research() : null));
    const cache = createResearchCache({ ...deps(fetcher), stored });
    expect((await cache(artist("a"), noPlaces)).retrievedAt).toBe("2026-11-01T12:00:00.000Z");
    expect(fetcher).not.toHaveBeenCalled();
    await cache(artist("b"), noPlaces);
    expect(fetcher).toHaveBeenCalled();
  });

  it("asks live when the stored results cannot be read", async () => {
    const fetcher = sources();
    const cache = createResearchCache({ ...deps(fetcher), stored: async () => Promise.reject(new Error("db down")) });
    expect((await cache(artist("a"), noPlaces)).sources[0]?.status).toBe("no_match");
  });

  it("reads a result stored before searched names and candidates were recorded", async () => {
    const { db } = await seeded("a");
    const { searchedNames, candidates, ...older } = research();
    await db.insert(researchResults).values({ artistId: "id-a", research: older as Research, generatedAt: new Date() });
    expect(await storedResearch(db)(artist("a"))).toMatchObject({ searchedNames, candidates });
  });

  it("reads a match stored before link notes were recorded", async () => {
    const { db } = await seeded("a");
    const match = { id: "Q1", label: "A", description: null, url: "https://www.wikidata.org/wiki/Q1", basis: "name" };
    await db.insert(researchResults).values({ artistId: "id-a", research: research({ match } as Partial<Research>), generatedAt: new Date() });
    expect((await storedResearch(db)(artist("a")))?.match).toEqual({ ...match, note: null });
  });

  it("tells when a stored result does not follow the reviewed link yet", () => {
    const match = { id: "Q1", label: "A", description: null, url: "https://www.wikidata.org/wiki/Q1", basis: "reviewed" as const, note: "ok" };
    const candidate = { id: "Q2", label: "B", description: null, url: "https://www.wikidata.org/wiki/Q2", birthYear: null, foundBy: "A", reason: "no_birth_year" as const };
    const confirmed = { confirmed: "Q1", rejected: [], note: "ok" };
    expect(linkOutdated(research({ match }), confirmed)).toBe(false);
    expect(linkOutdated(research(), confirmed)).toBe(true);
    expect(linkOutdated(research({ match: { ...match, basis: "name" } }), confirmed)).toBe(true);
    expect(linkOutdated(research({ match: { ...match, note: "antes" } }), confirmed)).toBe(true);
    const rejected = { confirmed: null, rejected: ["Q2"], note: null };
    expect(linkOutdated(research({ candidates: [candidate] }), rejected)).toBe(true);
    expect(linkOutdated(research({ match: { ...match, id: "Q2" } }), rejected)).toBe(true);
    expect(linkOutdated(research(), rejected)).toBe(false);
  });

  it("redoes only the stored results that do not follow their reviewed link, even without --force", async () => {
    const { db, data } = await seeded("a", "b");
    await generateResearch(db, data, deps(sources()), noWait);
    const link = { confirmed: null, rejected: ["Q9"], note: null };
    const linked = { ...deps(sources()), links: (a: Artist) => (a.slug === "a" ? link : null) };
    expect((await generateResearch(db, data, linked, noWait)).map((o) => o.outcome)).toEqual(["kept", "kept"]);
    const confirm = { confirmed: "Q9", rejected: [], note: null };
    const relinked = { ...deps(sources()), links: (a: Artist) => (a.slug === "a" ? confirm : null) };
    const outcomes = await generateResearch(db, data, relinked, noWait);
    expect(outcomes.map((o) => [o.slug, o.outcome])).toEqual([
      ["a", "failed"],
      ["b", "kept"],
    ]);
  });

  it("serves the stored result through the research query", async () => {
    const { db } = await seeded("a");
    await db
      .insert(researchResults)
      .values({ artistId: "id-a", research: research({ retrievedAt: "2026-11-02T00:00:00.000Z" }), generatedAt: new Date() });
    const { gql } = createTestApp(db);
    const result = await gql<{ research: { retrievedAt: string } }>(`{ research(slug: "a") { retrievedAt } }`);
    expect(result.data?.research.retrievedAt).toBe("2026-11-02T00:00:00.000Z");
  });

  it("serves a reviewed match with its note", async () => {
    const { db } = await seeded("a");
    const match = { id: "Q1", label: "A", description: null, url: "https://www.wikidata.org/wiki/Q1", basis: "reviewed" as const, note: "Conferido." };
    await db.insert(researchResults).values({ artistId: "id-a", research: research({ match }), generatedAt: new Date() });
    const { gql } = createTestApp(db);
    const result = await gql<{ research: { match: { basis: string; note: string } } }>(`{ research(slug: "a") { match { basis note } } }`);
    expect(result.data?.research.match).toEqual({ basis: "reviewed", note: "Conferido." });
  });
});
