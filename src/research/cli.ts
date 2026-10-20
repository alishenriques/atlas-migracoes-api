import "dotenv/config";
import { parseArgs } from "node:util";
import { createDatabase } from "../db/client.js";
import { indexDataset, loadDataset } from "../db/dataset.js";
import { loadEnv } from "../schemas/domain.js";
import { generateResearch } from "./stored.js";
import { createStatesLoader } from "./territories.js";

// Usage: yarn research:generate [--slug <slug> ...] [--force] [--delay <ms>]
// Runs on the machine that owns the database (the owner DATABASE_URL); the API only reads the results.
const { values } = parseArgs({
  options: {
    slug: { type: "string", multiple: true },
    force: { type: "boolean", default: false },
    delay: { type: "string", default: "6000" },
  },
});

const env = loadEnv();
const db = createDatabase(env);
if (!db) {
  console.error("DATABASE_URL não definida.");
  process.exit(1);
}
if (!env.GEMINI_API_KEY) console.warn("GEMINI_API_KEY não definida: os resultados serão gravados sem resumo (not_configured).");

const data = indexDataset(await loadDataset(db));
const outcomes = await generateResearch(
  db,
  data,
  {
    fetcher: fetch,
    gemini: env.GEMINI_API_KEY ? { apiKey: env.GEMINI_API_KEY, model: env.GEMINI_MODEL } : null,
    states: createStatesLoader(fetch, env.CARTOGRAPHY_URL),
  },
  { slugs: values.slug ?? [], force: values.force, delayMs: Number(values.delay) },
);
for (const { slug, outcome, detail } of outcomes) console.log(`${outcome.padEnd(6)} ${slug} (${detail})`);
const failed = outcomes.filter((outcome) => outcome.outcome === "failed").length;
console.log(`\n${outcomes.length} artistas: ${outcomes.length - failed} ok, ${failed} com falha (rode de novo para tentar só esses).`);
