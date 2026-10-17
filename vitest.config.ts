import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    // Keep a single copy of `graphql` so GraphQLError instanceof checks hold.
    server: { deps: { inline: [/graphql/] } },
  },
});
