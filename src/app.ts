import { createYoga } from "graphql-yoga";
import { createContext } from "./context.js";
import { createDatabase, type Database } from "./db/client.js";
import { queryLimits } from "./graphql/limits.js";
import { schema } from "./graphql/schema.js";
import { createResearchCache } from "./research/research.js";
import { createStatesLoader } from "./research/territories.js";
import type { Fetcher } from "./research/wikimedia.js";
import { loadEnv, type Env } from "./schemas/domain.js";

export type AppDependencies = {
  db?: Database | null;
  /** How the open sources, the borders file and Gemini are reached; tests pass a fake. */
  fetcher?: Fetcher;
};

export function createApp(env: Env = loadEnv(), deps: AppDependencies = {}) {
  const db = deps.db !== undefined ? deps.db : createDatabase(env);
  const fetcher = deps.fetcher ?? fetch;
  const research = createResearchCache({
    fetcher,
    gemini: env.GEMINI_API_KEY ? { apiKey: env.GEMINI_API_KEY, model: env.GEMINI_MODEL } : null,
    states: createStatesLoader(fetcher, env.CARTOGRAPHY_URL),
  });

  return createYoga({
    schema,
    graphqlEndpoint: "/graphql",
    // The explorer page is for local development; the public API serves the app only.
    graphiql: env.NODE_ENV !== "production",
    plugins: queryLimits(),
    cors: {
      origin: env.CORS_ORIGIN,
      credentials: false,
      allowedHeaders: ["Content-Type"],
    },
    context: createContext(env, db, research),
  });
}
