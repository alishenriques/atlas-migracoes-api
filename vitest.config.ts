import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    // The first PGlite boot and migration in a file takes a few seconds.
    testTimeout: 20_000,
    // Keep a single copy of `graphql` so GraphQLError instanceof checks hold.
    server: { deps: { inline: [/graphql/] } },
  },
});
