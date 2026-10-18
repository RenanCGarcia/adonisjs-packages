# Agent notes

- **Before writing code**: find the closest existing example and mirror its shape. Keep the diff to what the task needs; no drive-by renames or refactors.
- **Comments**: only for what the code can't say: why it's done this way, a non-obvious constraint, a link to an issue. Never restate what the names and the body already show; when in doubt, leave it out.
- **Done**: `pnpm typecheck && pnpm lint` pass, plus the narrowest relevant test. If a command can't run (missing infra, no network), report it with its output instead of claiming completion.
- **Playground**: `playground/` is the AdonisJS API kit, kept close to upstream so it stays a realistic fixture. Package tests run its ace commands; a behavior a package handles gets a route there, not a mock. Run `pnpm --filter playground setup:env` once to create its `.env`.
- **Releases**: a change to a published package ships with a changeset (`pnpm changeset`). Never bump versions or publish by hand.
- **AdonisJS docs**: for any AdonisJS question, read the v7 docs in `repos/adonisjs-docs/content` (`start/`, `guides/`, `reference/`) before guessing or searching the web. If the folder is missing or empty, run `pnpm docs:pull` (also updates it). It's gitignored, so root-level Grep/Glob skip it: pass the path explicitly. Read-only: never edit or import from it.
- **Lucid docs**: for any Lucid (ORM, query builder, migrations, factories) question, start with `repos/lucid-docs/docs/AI-REFERENCE-OVERVIEW.md`, then the topic file. Same rules as the AdonisJS docs.
- **VineJS docs**: for any validation question, read `repos/vinejs-docs/content/docs` (`guides/`, `types/`, `extend/`). Same rules as the AdonisJS docs.
