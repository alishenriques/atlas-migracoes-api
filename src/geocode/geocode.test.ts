import { describe, expect, it, vi } from "vitest";
import { createTestDatabase } from "../test/helpers.js";
import { places } from "../db/schema.js";
import type { Place } from "../schemas/domain.js";
import { applyCoordinates } from "./apply.js";
import { buildQuery, parseCandidates, searchPlace, USER_AGENT, type Fetcher } from "./nominatim.js";
import { geocodePlaces, type ReviewEntry } from "./review.js";

const place = (id: string, path: string[], currentName: string | null = null): Place => ({
  id,
  label: path.at(-1) ?? id,
  path,
  country: path[0],
  currentName,
  lat: null,
  lng: null,
});

const graz = place("austria-steiermark-graz", ["Áustria", "Steiermark", "Graz"]);
const sebastopol = place("russia-sebastopol", ["Rússia", "Sebastopol"], "Sebastopol, Ucrânia");
const nowhere = place("lugar-nenhum", ["Lugar Nenhum"]);

function fakeFetcher(results: Record<string, unknown[]>): Fetcher & ReturnType<typeof vi.fn> {
  return vi.fn(async (url: string) => {
    const query = new URL(url).searchParams.get("q") ?? "";
    return { ok: true, status: 200, json: async () => results[query] ?? [] };
  });
}

describe("buildQuery", () => {
  it("goes from the most specific name up and merges repeated neighbours", () => {
    expect(buildQuery(graz)).toBe("Graz, Steiermark, Áustria");
    expect(buildQuery({ path: ["Brasil", "São Paulo", "São Paulo"], currentName: null })).toBe("São Paulo, Brasil");
  });

  it("prefers the present-day name noted by the source", () => {
    expect(buildQuery(sebastopol)).toBe("Sebastopol, Ucrânia");
  });
});

describe("searchPlace", () => {
  it("identifies itself and asks for one result in Portuguese", async () => {
    const fetcher = fakeFetcher({ "Graz, Steiermark, Áustria": [{ lat: "47.07", lon: "15.43", display_name: "Graz" }] });
    expect(await searchPlace("Graz, Steiermark, Áustria", fetcher)).toMatchObject({ lat: 47.07, lng: 15.43 });
    const [url, init] = fetcher.mock.calls[0];
    expect(new URL(url).searchParams.get("limit")).toBe("1");
    expect(new URL(url).searchParams.get("accept-language")).toBe("pt");
    expect(init.headers["User-Agent"]).toBe(USER_AGENT);
  });

  it("fails loudly on an HTTP error instead of recording 'not found'", async () => {
    const fetcher: Fetcher = async () => ({ ok: false, status: 429, json: async () => [] });
    await expect(searchPlace("Graz", fetcher)).rejects.toThrow("429");
  });

  it("rejects an unexpected payload", () => {
    expect(() => parseCandidates([{ lat: "x" }])).toThrow();
  });
});

describe("geocodePlaces", () => {
  it("records candidates and misses, and never re-queries what is in the review file", async () => {
    const reviewed: ReviewEntry = {
      id: sebastopol.id,
      path: sebastopol.path,
      currentName: sebastopol.currentName,
      query: "Sebastopol, Ucrânia",
      status: "reviewed",
      lat: 44.6,
      lng: 33.52,
      displayName: "conferido à mão",
      osm: null,
      kind: null,
    };
    const fetcher = fakeFetcher({
      "Graz, Steiermark, Áustria": [{ lat: "47.07", lon: "15.43", display_name: "Graz, Steiermark, Áustria", osm_type: "relation", osm_id: "34719", addresstype: "city" }],
    });

    const entries = await geocodePlaces([graz, sebastopol, nowhere], [reviewed], { fetcher, interval: 0 });

    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(entries.map((entry) => [entry.id, entry.status])).toEqual([
      [graz.id, "auto"],
      [sebastopol.id, "reviewed"],
      [nowhere.id, "not_found"],
    ]);
    expect(entries[0]).toMatchObject({ lat: 47.07, lng: 15.43, osm: "relation/34719", kind: "city" });
    expect(entries[1]).toBe(reviewed);
  });
});

describe("applyCoordinates", () => {
  it("writes coordinates and lists what it could not apply", async () => {
    const db = await createTestDatabase();
    await db.insert(places).values([
      { id: graz.id, label: graz.label, path: graz.path, country: graz.country },
      { id: nowhere.id, label: nowhere.label, path: nowhere.path, country: nowhere.country },
    ]);
    const base = { path: [], currentName: null, query: "", displayName: null, osm: null, kind: null };

    const result = await applyCoordinates(db, [
      { ...base, id: graz.id, status: "auto", lat: 47.07, lng: 15.43 },
      { ...base, id: nowhere.id, status: "not_found", lat: null, lng: null },
      { ...base, id: "fora-da-base", status: "reviewed", lat: 1, lng: 1 },
    ]);

    expect(result).toEqual({ updated: 1, skipped: [nowhere.id], missing: ["fora-da-base"] });
    const rows = await db.select().from(places);
    expect(rows.find((row) => row.id === graz.id)).toMatchObject({ lat: 47.07, lng: 15.43 });
  });
});
