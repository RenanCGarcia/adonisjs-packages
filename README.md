# adonisjs-packages

AdonisJS packages published under the `@enzopita` scope.

| Package                                          | Description                                                                      |
| ------------------------------------------------ | -------------------------------------------------------------------------------- |
| [`@enzopita/adonisjs-openapi`](packages/openapi) | Generate an OpenAPI 3.1 document from routes, VineJS validators and transformers |

`playground/` is an AdonisJS API app that the package tests run against. It is not published.

## Develop

```sh
pnpm install
pnpm bootstrap   # builds the packages, creates playground/.env and runs its codegen
pnpm test
```

The playground and the package suites use SQLite (`playground/tmp/db.sqlite3`) by default. To run them on PostgreSQL, start the compose service, which listens on port 55432 with a `playground` database for development and a `playground_test` one for the suites:

```sh
pnpm db:up       # docker compose up, waits for the healthcheck
pnpm test:pg     # migrates playground_test, then runs every package suite on it
pnpm db:down
```

For the playground itself, set `DB_CONNECTION=pg` and the `DB_*` variables in `playground/.env`, as `playground/.env.example` shows.

## Release

Add a changeset with `pnpm changeset` in the pull request that changes a package. After the merge, the release workflow opens a "Version packages" pull request. Merging that pull request publishes to npm.
