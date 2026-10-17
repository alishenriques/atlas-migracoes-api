# atlas-migracoes-api

Before changing anything, read the ecosystem docs in the main repo: `../atlas-migracoes/docs/ai/README.md` (architecture, conventions, non-negotiables).

Quick rules: zero cost, everything typed and Zod-validated, tests required, throw `GraphQLError` (not `Error`) for client-visible errors, keep `.js` extensions in imports. Verify with `yarn lint && yarn typecheck && yarn test`.

## Data rules

- Never invent data. Unknown stays null, approximate dates keep their `precision`, and anything the importer cannot resolve goes to the import report, not into the base.
- The real MAC USP spreadsheets are never committed (public repo, `*.xlsx` ignored). Tests use the generated fixture in `src/test/helpers.ts`; the no-database mode serves the simulated records in `src/db/fallback.ts`, flagged by `meta.source = demo`.
- Place coordinates are owned by geocoding/manual review; the importer must never overwrite them.

## Scope and PR workflow (decided by Alisson, 2026-10-17)

- This API serves the Atlas app only (`atlas-migracoes`), read-only in the MVP. Researcher editing and auth come later in the roadmap.
- Big changes: new branch, then a detailed PR (what changed, what problem it solves, new or changed GraphQL types/operations and how to call them, migrations, architecture decisions, how it was verified). **Never merge without Alisson's explicit approval on the PR**; he reviews by commenting, so reply and fix on the same branch.
