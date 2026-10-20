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

`apps/inbox-console` is a React app for attendants, in Portuguese, on top of the playground's JSON routes under `/inbox`. An agent signs in, works the views (Minhas conversas, Não atribuídas, Com bot, Todas abertas, Resolvidas) and the queues, assumes, replies, assigns, transfers, returns and resolves conversations, and manages agents, queues and channels under Ajustes. "Simular cliente" writes in as a contact through the real webhook ingest. A refused action shows why in Portuguese, such as "Esta conversa já está com Ana Souza."

It calls the API through Tuyau and TanStack Query, typed from the playground's generated registry, so `pnpm typecheck` fails when a route or a transformer changes under it. Vite proxies `/inbox` and `/api` to the playground, so there is no CORS to set up.

To run it on PostgreSQL:

```sh
pnpm db:up
cd playground
# in .env: DB_CONNECTION=pg, DB_HOST=127.0.0.1, DB_PORT=55432, DB_USER=postgres,
# DB_PASSWORD=postgres, DB_DATABASE=playground
node ace migration:run
node ace inbox:seed   # queues, six agents, two fake channels and 20 conversations; safe to rerun
cd ..
pnpm --filter playground dev        # the API on http://localhost:3333
pnpm --filter inbox-console dev     # the console on http://localhost:5173
```

Then open `http://localhost:5173` and log in as `ana@inbox.test` with the password `inbox-password`. Every seeded agent uses that password, and the login screen lists them. "Atuando como" switches between agents, and asks for the password of an agent who hasn't signed in on this browser. Set `PLAYGROUND_URL` when the playground isn't on `http://localhost:3333`.

`node ace migration:fresh && node ace inbox:seed` starts over. With both servers running, `pnpm --filter inbox-console e2e` drives the console in Chrome through Playwright and saves screenshots to `apps/inbox-console/tmp/console-e2e`. Set `CONSOLE_URL` when the console isn't on `http://localhost:5173`.

## Release

Add a changeset with `pnpm changeset` in the pull request that changes a package. After the merge, the release workflow opens a "Version packages" pull request. Merging that pull request publishes to npm.
