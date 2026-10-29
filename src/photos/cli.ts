import "dotenv/config";
import { parseArgs } from "node:util";
import { createDatabase } from "../db/client.js";
import { loadEnv } from "../schemas/domain.js";
import { importPhotos, readPhotoDir } from "./import.js";

// Usage: yarn photos:import --dir <folder with <slug>.webp|jpg|png and an optional photos.json>
// The photos stay on the machine running the import and in the base; they are never committed.
const { values } = parseArgs({ options: { dir: { type: "string" } } });
if (!values.dir) {
  console.error("Informe a pasta das fotos: yarn photos:import --dir <pasta>");
  process.exit(1);
}

const db = createDatabase(loadEnv());
if (!db) {
  console.error("DATABASE_URL não definida.");
  process.exit(1);
}

const { files, skipped } = await readPhotoDir(values.dir);
const { imported, unknown } = await importPhotos(db, files);
console.log(`Fotos gravadas: ${imported.length ? imported.join(", ") : "nenhuma"}`);
if (unknown.length) console.warn(`Sem artista com esse slug (não gravadas): ${unknown.join(", ")}`);
if (skipped.length) console.warn(`Ignoradas (não são JPEG, PNG ou WebP válidos): ${skipped.join(", ")}`);
