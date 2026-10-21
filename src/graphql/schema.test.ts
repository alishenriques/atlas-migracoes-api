import { describe, expect, it } from "vitest";
import type { FuzzyDate } from "../schemas/domain.js";
import { byStart } from "./schema.js";

const start = (date: Partial<FuzzyDate>) => ({
  startDate: { raw: null, year: null, endYear: null, iso: null, precision: "unknown", ...date } satisfies FuzzyDate,
});

describe("byStart", () => {
  it("orders exact dates, then years, oldest first, with undated exhibitions last", () => {
    const undated = start({});
    const year1950 = start({ raw: "1950", year: 1950, endYear: 1950, precision: "year" });
    const exact = start({ raw: "12/03/1951", year: 1951, endYear: 1951, iso: "1951-03-12", precision: "day" });
    const year1948 = start({ raw: "1948", year: 1948, endYear: 1948, precision: "year" });

    expect([undated, year1950, exact, year1948].sort(byStart)).toEqual([year1948, year1950, exact, undated]);
    expect(byStart(undated, undated)).toBe(0);
  });
});
