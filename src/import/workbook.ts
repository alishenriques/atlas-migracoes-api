import ExcelJS from "exceljs";
import { slugify } from "./parse.js";

export type SheetKind = "works" | "exhibitions" | "publications";

/** A spreadsheet row keyed by the slug of its header ("Titulo, Data" → "titulo-data"). */
export type Row = Record<string, unknown>;

export type Sheet = { kind: SheetKind; source: string; rows: Row[] };

// One header that only that export has is enough to tell the sheets apart,
// whatever the file or tab is called.
const SIGNATURES: [SheetKind, string][] = [
  ["works", "tombo"],
  ["exhibitions", "titulo-da-exposicao"],
  ["publications", "titulo-da-publicacao"],
];

function cellValue(value: ExcelJS.CellValue): unknown {
  if (value === null || value === undefined) return null;
  if (value instanceof Date || typeof value !== "object") return value;
  if ("richText" in value) return value.richText.map((part) => part.text).join("");
  if ("result" in value) return value.result ?? null;
  if ("text" in value) return value.text;
  return null;
}

/** Reads every tab of a workbook that matches a known export; other tabs are skipped. */
export async function readWorkbook(input: string | Buffer, source: string): Promise<Sheet[]> {
  const workbook = new ExcelJS.Workbook();
  if (typeof input === "string") {
    await workbook.xlsx.readFile(input);
  } else {
    await workbook.xlsx.load(input as unknown as ArrayBuffer);
  }

  const sheets: Sheet[] = [];
  workbook.eachSheet((worksheet) => {
    const headers: string[] = [];
    worksheet.getRow(1).eachCell((cell, column) => {
      headers[column] = slugify(String(cellValue(cell.value) ?? ""));
    });
    const kind = SIGNATURES.find(([, header]) => headers.includes(header))?.[0];
    if (!kind) return;

    const rows: Row[] = [];
    worksheet.eachRow((row, number) => {
      if (number === 1) return;
      const record: Row = {};
      headers.forEach((header, column) => {
        if (header) record[header] = cellValue(row.getCell(column).value);
      });
      if (Object.values(record).some((value) => value !== null && value !== "")) rows.push(record);
    });
    sheets.push({ kind, source: `${source} › ${worksheet.name}`, rows });
  });
  return sheets;
}
