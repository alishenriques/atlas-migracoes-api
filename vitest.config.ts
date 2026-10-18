import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    // The first PGlite boot and migration in a file takes a few seconds.
    testTimeout: 20_000,
    // Keep a single copy of `graphql` so GraphQLError instanceof checks hold.
    server: { deps: { inline: [/graphql/] } },
    coverage: {
      provider: "v8",
      include: ["src/**/*.ts"],
      // Left out on purpose (see the ecosystem's architecture.md, "Test coverage"):
      // entry points that only wire env, files and process exit codes around
      // tested functions (the Vercel handler in api/ is outside src/), and the
      // declarative Drizzle table definitions, plus the test helpers themselves.
      exclude: [
        "src/index.ts",
        "src/**/cli.ts",
        "src/db/migrate.ts",
        "src/db/schema.ts",
        "src/test/**",
        "src/**/*.test.ts",
      ],
      reporter: ["text", "text-summary", "json-summary", "html"],
      // A floor, not a target: raise it whenever coverage goes up, never lower it.
      thresholds: {
        statements: 95,
        branches: 90,
        functions: 95,
        lines: 95,
      },
    },
  },
});
