import { describe, expect, it } from "vitest";
import { cleanText, parseFuzzyDate, parsePlace, slugify, splitIds, splitTitleAndDate } from "./parse.js";

describe("cleanText", () => {
  it("joins the padded multi-line cells of the export", () => {
    expect(cleanText("\n\t72,2 cm x 53,5 cm \n\n\n\tMancha - 59,8 cm x 43 cm \n\n")).toBe(
      "72,2 cm x 53,5 cm · Mancha - 59,8 cm x 43 cm",
    );
  });

  it("returns null for empty values", () => {
    expect(cleanText(null)).toBeNull();
    expect(cleanText("  \n\t ")).toBeNull();
  });
});

describe("slugify", () => {
  it("strips accents and punctuation", () => {
    expect(slugify("Moussia Pinto Alves")).toBe("moussia-pinto-alves");
    expect(slugify("Título da exposição")).toBe("titulo-da-exposicao");
    expect(slugify("País ➔ Estado ➔ Município ")).toBe("pais-estado-municipio");
  });
});

describe("parseFuzzyDate", () => {
  it.each([
    ["22/06/1946", { year: 1946, endYear: 1946, iso: "1946-06-22", precision: "day" }],
    [1901, { year: 1901, endYear: 1901, iso: null, precision: "year" }],
    ["1994", { year: 1994, precision: "year" }],
    ["03/1950", { year: 1950, iso: "1950-03", precision: "month" }],
    ["2005; 2ª edição revista e ampliada", { year: 2005, precision: "year", raw: "2005; 2ª edição revista e ampliada" }],
    ["11/2003; Novembro/Dezembro 2003", { year: 2003, iso: "2003-11", precision: "month" }],
    ["c. 1949", { year: 1949, precision: "circa" }],
    ["ca.1949", { year: 1949, precision: "circa" }],
    ["1940-1945", { year: 1940, endYear: 1945, precision: "range" }],
    ["1940-45", { year: 1940, endYear: 1945, precision: "range" }],
    ["década de 1950", { year: 1950, endYear: 1959, precision: "range" }],
    ["desconhecida", { year: null, precision: "unknown" }],
    ["s.d.", { year: null, precision: "unknown" }],
    ["31/13/1950", { year: null, precision: "unknown" }],
    ["1950-1940", { year: null, precision: "unknown" }],
  ])("reads %s", (input, expected) => {
    expect(parseFuzzyDate(input)).toMatchObject(expected);
  });

  it("keeps the raw text for auditing", () => {
    expect(parseFuzzyDate("c. 1949").raw).toBe("c. 1949");
  });

  it("reads Excel dates as UTC days", () => {
    expect(parseFuzzyDate(new Date(Date.UTC(1963, 3, 8)))).toMatchObject({ iso: "1963-04-08", precision: "day" });
  });
});

describe("splitTitleAndDate", () => {
  it("splits the date off the last comma", () => {
    expect(splitTitleAndDate("Sem título, 1940-1945  ")).toMatchObject({
      title: "Sem título",
      date: { year: 1940, endYear: 1945, precision: "range" },
    });
  });

  it("keeps commas that belong to the title", () => {
    expect(splitTitleAndDate("Paisagem, com rio")).toMatchObject({ title: "Paisagem, com rio", date: { precision: "unknown" } });
  });

  it("recognises s.d. as the date part", () => {
    expect(splitTitleAndDate("Retrato, s.d.")).toMatchObject({ title: "Retrato", date: { raw: "s.d.", precision: "unknown" } });
  });
});

describe("parsePlace", () => {
  it("drops the continent and keeps the present-day name aside", () => {
    expect(parsePlace("Europa➔Rússia➔Sebastopol [atual Sebastopol, Ucrânia]")).toEqual({
      id: "russia-sebastopol",
      label: "Sebastopol",
      path: ["Rússia", "Sebastopol"],
      country: "Rússia",
      currentName: "Sebastopol, Ucrânia",
    });
  });

  it("gives the same id with or without the continent", () => {
    expect(parsePlace("América➔Brasil➔São Paulo➔São Paulo")?.id).toBe(parsePlace("Brasil➔São Paulo➔São Paulo")?.id);
  });

  it.each([
    ["Rua Espírito Santo, 901Brasil➔Minas Gerais➔Belo Horizonte", ["Brasil", "Minas Gerais", "Belo Horizonte"]],
    ["Rua Piauí8441º andarBrasil➔São Paulo➔São Paulo", ["Brasil", "São Paulo", "São Paulo"]],
    ["Brasil➔Rio Grande do Sul➔Santa Maria3960", ["Brasil", "Rio Grande do Sul", "Santa Maria"]],
  ])("drops a street address glued onto %s", (input, path) => {
    const repairs: string[] = [];
    expect(parsePlace(input, (raw) => repairs.push(raw))?.path).toEqual(path);
    expect(repairs).toEqual([input]);
  });

  it("returns null for empty cells", () => {
    expect(parsePlace(null)).toBeNull();
  });
});

describe("splitIds", () => {
  it("splits and dedupes", () => {
    expect(splitIds("EM.2013.12.03;EX.2000.12.01; EM.2013.12.03")).toEqual(["EM.2013.12.03", "EX.2000.12.01"]);
    expect(splitIds(null)).toEqual([]);
  });
});
