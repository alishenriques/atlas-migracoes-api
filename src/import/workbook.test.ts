import { describe, expect, it } from "vitest";
import { cellValue } from "./workbook.js";

describe("cellValue", () => {
  it("keeps plain values and turns empty cells into null", () => {
    expect(cellValue(null)).toBeNull();
    expect(cellValue(undefined)).toBeNull();
    expect(cellValue("Tombo")).toBe("Tombo");
    expect(cellValue(1952)).toBe(1952);
    const date = new Date("1952-05-01T00:00:00Z");
    expect(cellValue(date)).toBe(date);
  });

  it("joins rich text, resolves formulas and reads hyperlinks", () => {
    expect(cellValue({ richText: [{ text: "Lasar " }, { text: "Segall" }] })).toBe("Lasar Segall");
    expect(cellValue({ formula: "A1", result: 7 })).toBe(7);
    expect(cellValue({ formula: "A1", result: undefined })).toBeNull();
    expect(cellValue({ text: "MAC USP", hyperlink: "https://mac.usp.br" })).toBe("MAC USP");
  });

  it("returns null for cell objects it does not know", () => {
    expect(cellValue({ error: "#N/A" })).toBeNull();
  });
});
