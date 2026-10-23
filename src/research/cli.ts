import "dotenv/config";
import { parseArgs } from "node:util";
import { createDatabase } from "../db/client.js";
import { indexDataset, loadDataset } from "../db/dataset.js";
import { loadEnv } from "../schemas/domain.js";
import { generateResearch } from "./stored.js";
import { createStatesLoader } from "./territories.js";

// Usage: yarn research:generate [--slug <slug> ...] [--force | --stale-period] [--delay <ms>] [--retries <n>]
// Runs on the machine that owns the database (the owner DATABASE_URL); the API only reads the results.
const { values } = parseArgs({
  options: {
    slug: { type: "string", multiple: true },
    force: { type: "boolean", default: false },
    "stale-period": { type: "boolean", default: false },
    delay: { type: "string", default: "6000" },
    retries: { type: "string", default: "2" },
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
    // Nobody is waiting on a page here, so the model gets a minute for long prompts.
    gemini: env.GEMINI_API_KEY ? { apiKey: env.GEMINI_API_KEY, model: env.GEMINI_MODEL, timeoutMs: 60_000 } : null,
    states: createStatesLoader(fetch, env.CARTOGRAPHY_URL),
  },
  { slugs: values.slug ?? [], force: values.force, stalePeriod: values["stale-period"], delayMs: Number(values.delay), retries: Number(values.retries) },
);
for (const { slug, outcome, detail } of outcomes) console.log(`${outcome.padEnd(6)} ${slug} (${detail})`);
const failed = outcomes.filter((outcome) => outcome.outcome === "failed").length;
console.log(`\n${outcomes.length} artistas: ${outcomes.length - failed} ok, ${failed} com falha (rode de novo para tentar só esses).`);
if (outcomes.some((outcome) => outcome.detail.includes("429")))
  console.log("Gemini respondeu 429: a cota diária do plano gratuito acabou. Rode de novo amanhã, sem --force, para tentar só os que falharam.");
