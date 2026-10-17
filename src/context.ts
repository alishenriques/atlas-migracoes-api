import type { Database } from "./db/client.js";
import { indexDataset, loadDataset, type DatasetIndex } from "./db/dataset.js";
import { demoDataset } from "./db/fallback.js";
import type { DataSource, Env } from "./schemas/domain.js";

export type AppContext = {
  env: Env;
  db: Database | null;
  source: DataSource;
  /** The collection, loaded at most once per request. */
  data: () => Promise<DatasetIndex>;
};

const demoIndex = indexDataset(demoDataset);

export function createContext(env: Env, db: Database | null) {
  return function context(): AppContext {
    let pending: Promise<DatasetIndex> | undefined;
    return {
      env,
      db,
      source: db ? "database" : "demo",
      data: () => {
        if (!db) return Promise.resolve(demoIndex);
        pending ??= loadDataset(db).then(indexDataset);
        return pending;
      },
    };
  };
}
