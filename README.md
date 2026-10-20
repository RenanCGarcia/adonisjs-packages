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

## Inbox console

The playground serves a console for the inbox packages at `/console`. It is one HTML page that calls the playground's JSON routes under `/inbox`. From it you can filter tickets, open one with its messages, events and flow runs, assume, assign, transfer, return, close, reply and mark read. It also creates agents, queues and fake channels, and simulates a contact writing in through the real webhook ingest. A rejected action shows the reason the inbox gave, such as `held_by_other` or `forbidden`.

To run it on PostgreSQL:

```sh
pnpm db:up
cd playground
# in .env: DB_CONNECTION=pg, DB_HOST=127.0.0.1, DB_PORT=55432, DB_USER=postgres,
# DB_PASSWORD=postgres, DB_DATABASE=playground
node ace migration:run
node ace inbox:seed   # queues, six agents, two fake channels and 20 conversations; safe to rerun
node ace serve --hmr
```

Then open `http://localhost:3333/console` and log in as `ana@inbox.test` with the password `inbox-password`. Every seeded agent uses that password. The "Acting as" menu switches between agents, and it asks for the password of an agent it has no token for.

`node ace migration:fresh && node ace inbox:seed` starts over. With the server running, `node scripts/console_e2e.js` drives the console in Chrome through Playwright and saves screenshots to `tmp/console-e2e`. Set `CONSOLE_URL` when the server isn't on `http://localhost:3333`.

## Release

Add a changeset with `pnpm changeset` in the pull request that changes a package. After the merge, the release workflow opens a "Version packages" pull request. Merging that pull request publishes to npm.
