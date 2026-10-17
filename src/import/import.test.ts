import { beforeAll, describe, expect, it } from "vitest";
import { createTestApp, createTestDatabase, buildFixtureWorkbook } from "../test/helpers.js";
import { normalizeSheets } from "./normalize.js";
import { persistImport } from "./persist.js";
import { readWorkbook, type Sheet } from "./workbook.js";
import { places } from "../db/schema.js";
import { eq } from "drizzle-orm";

let sheets: Sheet[];

beforeAll(async () => {
  sheets = await readWorkbook(await buildFixtureWorkbook(), "fixture.xlsx");
});

describe("readWorkbook", () => {
  it("recognises each export by its headers and skips other tabs", () => {
    expect(sheets.map((sheet) => [sheet.kind, sheet.rows.length])).toEqual([
      ["works", 3],
      ["exhibitions", 1],
      ["publications", 1],
    ]);
  });
});

describe("normalizeSheets", () => {
  it("builds artists, places and works without inventing data", () => {
    const { dataset } = normalizeSheets(sheets);
    expect(dataset.artists.map((artist) => artist.slug)).toEqual(["ana-teste", "bruno-exemplo"]);
    expect(dataset.places.map((place) => place.id).sort()).toEqual([
      "austria-viena",
      "brasil-sao-paulo-sao-paulo",
      "russia-sebastopol",
    ]);
    const bruno = dataset.artists.find((artist) => artist.slug === "bruno-exemplo");
    expect(bruno?.birthDate.precision).toBe("circa");
    expect(bruno?.deathPlaceId).toBeNull();
    expect(dataset.works.find((work) => work.id === "T.1")).toMatchObject({
      title: "Sem título",
      dimensions: "72,2 cm x 53,5 cm · Mancha - 59 cm",
      acquisitionDate: { iso: "1963-04-08" },
    });
  });

  it("reports references to records missing from the exports", () => {
    const result = normalizeSheets(sheets);
    expect(result.unresolvedExhibitionRefs).toEqual([{ workId: "T.1", exhibitionId: "EX.404" }]);
    expect(result.unresolvedPublicationRefs).toEqual([{ workId: "T.3", publicationId: "PB.999" }]);
    expect(result.dataset.works.find((work) => work.id === "T.1")?.exhibitionIds).toEqual(["EX.1"]);
  });
});

describe("persistImport", () => {
  it("is safe to re-run and keeps place coordinates", async () => {
    const db = await createTestDatabase();
    const result = normalizeSheets(sheets);
    await persistImport(db, result, ["fixture.xlsx"]);
    await db.update(places).set({ lat: -23.55, lng: -46.63 }).where(eq(places.id, "brasil-sao-paulo-sao-paulo"));

    const report = await persistImport(db, result, ["fixture.xlsx"]);
    expect(report.counts).toEqual({ places: 3, artists: 2, works: 3, exhibitions: 1, publications: 1 });

    const { gql } = createTestApp(db);
    const response = await gql<{
      meta: { source: string };
      stats: { works: number; originCountries: number };
      artist: { works: { id: string }[]; exhibitions: { title: string; place: { lat: number } }[] };
    }>(`{
      meta { source }
      stats { works originCountries }
      artist(slug: "ana-teste") { works { id } exhibitions { title place { lat } } }
    }`);
    expect(response.errors).toBeUndefined();
    expect(response.data?.meta.source).toBe("database");
    expect(response.data?.stats).toEqual({ works: 3, originCountries: 2 });
    expect(response.data?.artist.works.map((work) => work.id).sort()).toEqual(["T.1", "T.2"]);
    expect(response.data?.artist.exhibitions).toEqual([{ title: "Mostra de teste", place: { lat: -23.55 } }]);
  });
});
