import "dotenv/config";
import { readdir } from "node:fs/promises";
import { basename, join } from "node:path";
import { parseArgs } from "node:util";
import { createDatabase } from "../db/client.js";
import { loadEnv } from "../schemas/domain.js";
import { readPlaceCorrections } from "./corrections.js";
import { normalizeSheets } from "./normalize.js";
import { buildReport, persistImport } from "./persist.js";
import { readWorkbook, type Sheet } from "./workbook.js";

// Usage: yarn import:xlsx --dir <folder with the .xlsx exports> [--corrections <file.json>] [--dry-run]
// The spreadsheets stay on the machine running the import; they are never committed.
const { values } = parseArgs({
  options: {
    dir: { type: "string" },
    corrections: { type: "string" },
    "dry-run": { type: "boolean", default: false },
  },
});

if (!values.dir) {
  console.error("Informe a pasta das planilhas: yarn import:xlsx --dir <pasta> [--corrections <arquivo.json>] [--dry-run]");
  process.exit(1);
}

const files = (await readdir(values.dir)).filter((name) => name.endsWith(".xlsx") && !name.startsWith("~$"));
const sheets: Sheet[] = [];
for (const file of files) {
  const found = await readWorkbook(join(values.dir, file), file);
  if (found.length === 0) console.warn(`Ignorada (nenhuma aba reconhecida): ${file}`);
  sheets.push(...found);
}

const placeCorrections = values.corrections ? await readPlaceCorrections(values.corrections) : [];
const result = normalizeSheets(sheets, { placeCorrections });
const env = loadEnv();
const db = values["dry-run"] ? null : createDatabase(env);
if (!values["dry-run"] && !db) {
  console.error("DATABASE_URL não definida. Use --dry-run para só validar as planilhas.");
  process.exit(1);
}

const report = db ? await persistImport(db, result, files.map((file) => basename(file))) : buildReport(result);
console.log(JSON.stringify({ dryRun: values["dry-run"], sheets: sheets.map((s) => s.source), ...report }, null, 2));
