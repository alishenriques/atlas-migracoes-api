import "dotenv/config";
import { readFile, readdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { createDatabase } from "../db/client.js";
import { readPlaceCorrections } from "../import/corrections.js";
import { normalizeSheets } from "../import/normalize.js";
import { readWorkbook } from "../import/workbook.js";
import { loadEnv } from "../schemas/domain.js";
import { applyCoordinates } from "./apply.js";
import { geocodePlaces, reviewFileSchema, type ReviewEntry } from "./review.js";

// yarn geocode --dir <planilhas> --out <lugares.json> [--corrections <correcoes.json>]   busca no Nominatim e grava o arquivo de revisão
// yarn geocode --apply <lugares.json>                     grava as coordenadas revisadas no banco
// The review file holds place names from the collection: keep it off the repo.
const { values } = parseArgs({
  options: {
    dir: { type: "string" },
    out: { type: "string" },
    apply: { type: "string" },
    corrections: { type: "string" },
  },
});

async function readReview(path: string): Promise<ReviewEntry[]> {
  try {
    return reviewFileSchema.parse(JSON.parse(await readFile(path, "utf8")));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
}

if (values.apply) {
  const db = createDatabase(loadEnv());
  if (!db) {
    console.error("DATABASE_URL não definida.");
    process.exit(1);
  }
  console.log(JSON.stringify(await applyCoordinates(db, await readReview(values.apply)), null, 2));
} else if (values.dir && values.out) {
  const out = values.out;
  const files = (await readdir(values.dir)).filter((name) => name.endsWith(".xlsx") && !name.startsWith("~$"));
  const sheets = (await Promise.all(files.map((file) => readWorkbook(join(values.dir as string, file), file)))).flat();
  const placeCorrections = values.corrections ? await readPlaceCorrections(values.corrections) : [];
  const { dataset } = normalizeSheets(sheets, { placeCorrections });
  const previous = await readReview(out);

  const entries = await geocodePlaces(dataset.places, previous, {
    onEntry: (entry) => console.log(`${entry.status === "auto" ? "✓" : "✗"} ${entry.query} → ${entry.displayName ?? "não encontrado"}`),
  });
  await writeFile(out, `${JSON.stringify(entries, null, 2)}\n`);

  const pending = entries.filter((entry) => entry.status !== "reviewed").length;
  const notFound = entries.filter((entry) => entry.status === "not_found").length;
  console.log(`\n${entries.length} lugares, ${notFound} sem resultado, ${pending} a revisar em ${out}.`);
} else {
  console.error("Uso: yarn geocode --dir <planilhas> --out <lugares.json> | yarn geocode --apply <lugares.json>");
  process.exit(1);
}
