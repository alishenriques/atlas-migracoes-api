import type { Database } from "./db/client.js";
import { indexDataset, loadDataset, type DatasetIndex } from "./db/dataset.js";
import { demoDataset } from "./db/fallback.js";
import type { ArtistPlaces, Research } from "./research/research.js";
import type { Artist, DataSource, Env } from "./schemas/domain.js";

export type AppContext = {
  env: Env;
  db: Database | null;
  source: DataSource;
  /** Where this API is reached (e.g. https://api.example), to build absolute photo URLs. */
  origin: string;
  /** The collection, loaded at most once every `datasetTtlMs` per running instance. */
  data: () => Promise<DatasetIndex>;
  /** Open-source research on an artist, cached per artist (see research/research.ts). */
  research: (artist: Artist, places: ArtistPlaces) => Promise<Research>;
};

const demoIndex = indexDataset(demoDataset);

/**
 * The base only changes when the spreadsheets are re-imported, so each running
 * instance keeps the loaded collection for a few minutes instead of reading
 * all eight tables on every request. A burst of traffic then costs one read
 * per instance, not one per request, which keeps the Neon free compute in
 * reserve. A failed load is not kept.
 */
export function createContext(
  env: Env,
  db: Database | null,
  research: AppContext["research"],
  datasetTtlMs = 5 * 60 * 1000,
  clock = () => Date.now(),
) {
  let cached: { at: number; index: Promise<DatasetIndex> } | undefined;
  const data = (): Promise<DatasetIndex> => {
    if (!db) return Promise.resolve(demoIndex);
    const now = clock();
    if (cached && now - cached.at < datasetTtlMs) return cached.index;
    const entry = { at: now, index: loadDataset(db).then(indexDataset) };
    entry.index.catch(() => {
      if (cached === entry) cached = undefined;
    });
    cached = entry;
    return entry.index;
  };

  return function context(initial: { request?: Request } = {}): AppContext {
    const origin = initial.request ? new URL(initial.request.url).origin : `http://localhost:${env.PORT}`;
    return { env, db, source: db ? "database" : "demo", origin, research, data };
  };
}
