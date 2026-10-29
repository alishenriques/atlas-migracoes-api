import { describe, expect, it } from "vitest";
import type { Artist, FuzzyDate } from "../schemas/domain.js";
import { parseLinks } from "./links.js";

const unknownDate: FuzzyDate = { raw: null, year: null, endYear: null, iso: null, precision: "unknown" };
const artist = (slug: string): Artist => ({
  id: `id-${slug}`,
  slug,
  name: slug,
  birthPlaceId: null,
  birthDate: unknownDate,
  deathPlaceId: null,
  deathDate: unknownDate,
});
const artists = [artist("a"), artist("b"), artist("c")];

describe("parseLinks", () => {
  it("reads confirmed and rejected items with their notes", () => {
    const links = parseLinks(
      { a: { confirmed: "Q123", note: " Sem o nome do meio no Wikidata. " }, b: { rejected: ["Q456"] } },
      artists,
    );
    expect(links(artist("a"))).toEqual({ confirmed: "Q123", rejected: [], note: "Sem o nome do meio no Wikidata." });
    expect(links(artist("b"))).toEqual({ confirmed: null, rejected: ["Q456"], note: null });
    expect(links(artist("c"))).toBeNull();
  });

  it("refuses ids that are not Wikidata items, empty and contradictory entries, and unknown fields", () => {
    expect(() => parseLinks({ a: { confirmed: "16163283" } }, artists)).toThrow(/Wikidata item id/);
    expect(() => parseLinks({ a: { note: "só uma nota" } }, artists)).toThrow(/confirm one item/);
    expect(() => parseLinks({ a: { confirmed: "Q1", rejected: ["Q1"] } }, artists)).toThrow(/confirmed and rejected/);
    expect(() => parseLinks({ a: { confirmed: "Q1", qid: "Q2" } }, artists)).toThrow();
  });

  it("refuses an artist that is not in the base instead of ignoring it", () => {
    expect(() => parseLinks({ z: { confirmed: "Q1" } }, artists)).toThrow("unknown artists in the links file: z");
  });
});
