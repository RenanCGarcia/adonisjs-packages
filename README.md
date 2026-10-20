# adonisjs-packages

AdonisJS packages published under the `@enzopita` scope.

| Package                                          | Description                                                                      |
| ------------------------------------------------ | -------------------------------------------------------------------------------- |
| [`@enzopita/adonisjs-openapi`](packages/openapi) | Generate an OpenAPI 3.1 document from routes, VineJS validators and transformers |

## Develop

```sh
pnpm install
pnpm test
```

Each package's suite runs on a minimal AdonisJS app in its `tests/fixtures/app`, a host with the package installed. The suites use SQLite, in a file under that app's `tmp/`, by default. To run them on PostgreSQL, start the compose service, which listens on port 55432:

```sh
pnpm db:up       # docker compose up, waits for the healthcheck
pnpm test:pg     # runs the inbox and inbox-flows suites, each on a database of its own
pnpm db:down
```

## Release

Add a changeset with `pnpm changeset` in the pull request that changes a package. After the merge, the release workflow opens a "Version packages" pull request. Merging that pull request publishes to npm.
