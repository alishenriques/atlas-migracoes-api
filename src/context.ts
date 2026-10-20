import type { Database } from "./db/client.js";
import { indexDataset, loadDataset, type DatasetIndex } from "./db/dataset.js";
import { demoDataset } from "./db/fallback.js";
import type { ArtistPlaces, Research } from "./research/research.js";
import type { Artist, DataSource, Env } from "./schemas/domain.js";

export type AppContext = {
  env: Env;
  db: Database | null;
  source: DataSource;
  /** The collection, loaded at most once per request. */
  data: () => Promise<DatasetIndex>;
  /** Open-source research on an artist, cached per artist (see research/research.ts). */
  research: (artist: Artist, places: ArtistPlaces) => Promise<Research>;
};

const demoIndex = indexDataset(demoDataset);

export function createContext(env: Env, db: Database | null, research: AppContext["research"]) {
  return function context(): AppContext {
    let pending: Promise<DatasetIndex> | undefined;
    return {
      env,
      db,
      source: db ? "database" : "demo",
      research,
      data: () => {
        if (!db) return Promise.resolve(demoIndex);
        pending ??= loadDataset(db).then(indexDataset);
        return pending;
      },
    };
  };
}
