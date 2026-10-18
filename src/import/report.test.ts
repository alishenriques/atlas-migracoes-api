import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { buildFixtureWorkbook } from "../test/helpers.js";
import { readPlaceCorrections } from "./corrections.js";
import { normalizeSheets } from "./normalize.js";
import { readWorkbook, type Sheet } from "./workbook.js";

const tempFile = async (name: string, content: string | Buffer) => {
  const file = join(await mkdtemp(join(tmpdir(), "atlas-import-")), name);
  await writeFile(file, content);
  return file;
};

describe("normalizeSheets, incomplete rows", () => {
  it("leaves rows without an id or title out of the base and reports their line", () => {
    const sheets: Sheet[] = [
      { kind: "works", source: "obras.xlsx", rows: [{ tombo: "T.9", artista: null }] },
      { kind: "exhibitions", source: "exposicoes.xlsx", rows: [{ identificador: "EX.9", "titulo-da-exposicao": " " }] },
      { kind: "publications", source: "publicacoes.xlsx", rows: [{ identificador: null, "titulo-da-publicacao": "Catálogo" }] },
    ];

    const { dataset, warnings } = normalizeSheets(sheets);

    expect(dataset.works).toEqual([]);
    expect(dataset.exhibitions).toEqual([]);
    expect(dataset.publications).toEqual([]);
    expect(warnings.sort()).toEqual([
      "exposicoes.xlsx, linha 2: exposição sem identificador ou título, ignorada.",
      "obras.xlsx, linha 2: obra sem tombo ou artista, ignorada.",
      "publicacoes.xlsx, linha 2: publicação sem identificador ou título, ignorada.",
    ]);
  });
});

describe("readWorkbook from a path", () => {
  it("reads a workbook file the same way as a buffer", async () => {
    const file = await tempFile("fixture.xlsx", await buildFixtureWorkbook());
    const sheets = await readWorkbook(file, "fixture.xlsx");
    expect(sheets.map((sheet) => sheet.kind)).toEqual(["works", "exhibitions", "publications"]);
  });
});

describe("readPlaceCorrections", () => {
  it("reads a reviewed corrections file", async () => {
    const file = await tempFile(
      "correcoes.json",
      JSON.stringify([{ match: ["Russia", "Sebastopol"], currentName: "Sebastopol, Crimeia" }]),
    );
    await expect(readPlaceCorrections(file)).resolves.toEqual([
      { match: ["Russia", "Sebastopol"], currentName: "Sebastopol, Crimeia" },
    ]);
  });

  it("rejects a correction that changes nothing", async () => {
    const file = await tempFile("correcoes.json", JSON.stringify([{ match: ["Russia", "Sebastopol"] }]));
    await expect(readPlaceCorrections(file)).rejects.toThrow("informe path, currentName ou os dois");
  });
});
