import "dotenv/config";
import { parseArgs } from "node:util";
import { createDatabase } from "../db/client.js";
import { indexDataset, loadDataset } from "../db/dataset.js";
import { loadEnv } from "../schemas/domain.js";
import { generateResearch } from "./stored.js";
import { createStatesLoader } from "./territories.js";

// Usage: yarn research:generate [--slug <slug> ...] [--force | --stale-period] [--limit <calls>] [--delay <ms>] [--retries <n>]
// Runs on the machine that owns the database (the owner DATABASE_URL); the API only reads the results.
const { values } = parseArgs({
  options: {
    slug: { type: "string", multiple: true },
    force: { type: "boolean", default: false },
    "stale-period": { type: "boolean", default: false },
    limit: { type: "string" },
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
  {
    slugs: values.slug ?? [],
    force: values.force,
    stalePeriod: values["stale-period"],
    limit: values.limit === undefined ? undefined : Number(values.limit),
    delayMs: Number(values.delay),
    retries: Number(values.retries),
  },
);
for (const { slug, outcome, detail } of outcomes) console.log(`${outcome.padEnd(7)} ${slug} (${detail})`);
const count = (kind: string) => outcomes.filter((outcome) => outcome.outcome === kind).length;
const [failed, skipped] = [count("failed"), count("skipped")];
console.log(
  `\n${outcomes.length} artistas: ${outcomes.length - failed - skipped} ok, ${failed} com falha, ${skipped} não tentados. Rode o mesmo comando de novo (sem --force) para tentar só esses.`,
);
if (outcomes.some((outcome) => outcome.detail.includes("daily quota")))
  console.log("Gemini respondeu 429 pela cota diária do plano gratuito: o script parou de chamá-lo. Rode de novo depois que a cota renovar (meia-noite no horário do Pacífico).");
