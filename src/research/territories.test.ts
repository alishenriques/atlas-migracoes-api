import { describe, expect, it, vi } from "vitest";
import type { Artist, FuzzyDate, Place } from "../schemas/domain.js";
import { createStatesLoader, loadStates, periodContext, stateAt, statesOn, type States } from "./territories.js";
import type { Fetcher } from "./wikimedia.js";

const square = (west: number, south: number, east: number, north: number): [number, number][] => [
  [west, south],
  [east, south],
  [east, north],
  [west, north],
  [west, south],
];

// Simplified borders: the same square held by two states one after the other,
// with a hole for a city-state, and a second state made of two islands.
const states: States = {
  features: [
    {
      properties: { name: "Russia (Soviet Union)", start: "1886-01-01", end: "1917-12-31" },
      geometry: { type: "Polygon", coordinates: [square(20, 50, 30, 60), square(24, 54, 26, 56)] },
    },
    {
      properties: { name: "Poland", start: "1918-11-11", end: "1939-09-27" },
      geometry: { type: "Polygon", coordinates: [square(20, 50, 30, 60)] },
    },
    {
      properties: { name: "Danzig", start: "1886-01-01", end: "1939-09-27" },
      geometry: { type: "Polygon", coordinates: [square(24, 54, 26, 56)] },
    },
    {
      properties: { name: "Austria-Hungary", start: "1886-01-01", end: "1918-11-12" },
      geometry: { type: "MultiPolygon", coordinates: [[square(10, 45, 15, 48)], [square(16, 45, 19, 48)]] },
    },
  ],
  // As in the app's state-names.json; Danzig is left out to show the fallback.
  names: {
    "Russia (Soviet Union)": [
      { until: "1917-03-15", pt: "Império Russo" },
      { until: "1917-11-07", pt: "Rússia (Governo Provisório)" },
      { until: "1922-12-29", pt: "Rússia Soviética" },
      { pt: "União Soviética" },
    ],
    Poland: [{ pt: "Polônia" }],
    "Austria-Hungary": [{ pt: "Áustria-Hungria" }],
  },
};
const { names, ...borders } = states;

const date = (year: number | null, precision: FuzzyDate["precision"] = "year"): FuzzyDate => ({
  raw: year === null ? null : String(year),
  year,
  endYear: year,
  iso: null,
  precision: year === null ? "unknown" : precision,
});

const place = (lng: number | null, lat: number | null): Place => ({
  id: "p",
  label: "Vilna",
  path: ["Polônia", "Vilna"],
  country: "Polônia",
  currentName: "Vilnius, Lituânia",
  lat,
  lng,
});

const artist = (birthDate: FuzzyDate): Artist => ({
  id: "a",
  slug: "a",
  name: "A",
  birthPlaceId: "p",
  birthDate,
  deathPlaceId: null,
  deathDate: date(null),
});

describe("stateAt", () => {
  it("finds the state that held a point on a day", () => {
    expect(stateAt(states, "1900-07-01", 22, 52)).toBe("Império Russo");
    expect(stateAt(states, "1925-07-01", 22, 52)).toBe("Polônia");
    expect(stateAt(states, "1900-07-01", 18, 46)).toBe("Áustria-Hungria");
  });

  it("leaves holes, gaps between states and the sea to nobody", () => {
    expect(stateAt(states, "1900-07-01", 25, 55)).toBe("Danzig");
    expect(stateAt(states, "1918-07-01", 22, 52)).toBeNull();
    expect(stateAt(states, "1900-07-01", 0, 0)).toBeNull();
  });
});

describe("statesOn", () => {
  it("lists the states in force on a day, alphabetically", () => {
    expect(statesOn(states, "1900-07-01")).toEqual(["Áustria-Hungria", "Danzig", "Império Russo"]);
    expect(statesOn(states, "1917-07-01")).toEqual(["Áustria-Hungria", "Danzig", "Rússia (Governo Provisório)"]);
  });
});

describe("periodContext", () => {
  it("reads the map on 1 July of the birth year", () => {
    expect(periodContext(states, artist(date(1891)), place(22, 52))).toEqual({
      day: "1891-07-01",
      approximate: false,
      birthState: "Império Russo",
      states: ["Áustria-Hungria", "Danzig", "Império Russo"],
    });
  });

  it("flags an approximate birth year and a birthplace without coordinates", () => {
    expect(periodContext(states, artist(date(1925, "circa")), place(null, null))).toMatchObject({
      approximate: true,
      birthState: null,
      states: ["Danzig", "Polônia"],
    });
    expect(periodContext(states, artist(date(1925, "range")), null)?.approximate).toBe(true);
  });

  it("is null when the year is unknown or outside the borders' coverage", () => {
    expect(periodContext(states, artist(date(null)), place(22, 52))).toBeNull();
    expect(periodContext(states, artist(date(1850)), place(22, 52))).toBeNull();
    expect(periodContext(states, artist(date(2020)), place(22, 52))).toBeNull();
  });
});

const answer = (body: unknown, ok = true) => ({ ok, status: ok ? 200 : 404, json: async () => body });

/** Serves the borders, and the names beside them. */
const files = (bordersBody: unknown, namesBody: unknown = names) =>
  vi.fn<Fetcher>(async (url) => answer(url.endsWith("state-names.json") ? namesBody : bordersBody));

describe("loadStates", () => {
  it("validates the borders file and the names beside it", async () => {
    const fetcher = files({ type: "FeatureCollection", ...borders });
    expect(await loadStates(fetcher, "https://atlas.example/cartography/states.geojson")).toEqual(states);
    expect(fetcher.mock.calls.map(([url]) => url)).toContain("https://atlas.example/cartography/state-names.json");
    await expect(loadStates(files({ features: [{}] }), "https://atlas.example/x")).rejects.toThrow();
    await expect(loadStates(async () => answer({}, false), "https://atlas.example/x")).rejects.toThrow(
      "atlas.example answered 404",
    );
  });

  it("rejects names out of order, or a last period with an end", async () => {
    const load = (periods: unknown) => loadStates(files(borders, { Poland: periods }), "https://atlas.example/x");
    await expect(load([{ until: "1920-01-01", pt: "A" }])).rejects.toThrow();
    await expect(load([{ pt: "A" }, { pt: "B" }])).rejects.toThrow();
    await expect(
      load([{ until: "1920-01-01", pt: "A" }, { until: "1910-01-01", pt: "B" }, { pt: "C" }]),
    ).rejects.toThrow();
  });
});

describe("createStatesLoader", () => {
  it("loads once, and tries again after a failure", async () => {
    const fetcher = vi
      .fn<Fetcher>()
      .mockResolvedValueOnce(answer({}, false))
      .mockImplementation(async (url) => answer(url.endsWith("state-names.json") ? names : borders));
    const load = createStatesLoader(fetcher, "https://atlas.example/states.geojson");
    expect(await load()).toBeNull();
    expect(await load()).toEqual(states);
    expect(await load()).toEqual(states);
    expect(fetcher).toHaveBeenCalledTimes(4); // two loads, two files each
  });
});
