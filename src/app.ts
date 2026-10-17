import { createYoga } from "graphql-yoga";
import { createContext } from "./context.js";
import { createDatabase, type Database } from "./db/client.js";
import { schema } from "./graphql/schema.js";
import { loadEnv, type Env } from "./schemas/domain.js";

export type AppDependencies = {
  db?: Database | null;
};

export function createApp(env: Env = loadEnv(), deps: AppDependencies = {}) {
  const db = deps.db !== undefined ? deps.db : createDatabase(env);

  return createYoga({
    schema,
    graphqlEndpoint: "/graphql",
    cors: {
      origin: env.CORS_ORIGIN,
      credentials: false,
      allowedHeaders: ["Content-Type"],
    },
    context: createContext(env, db),
  });
}
