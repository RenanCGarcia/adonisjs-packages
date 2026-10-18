# adonisjs-packages

AdonisJS packages published under the `@enzopita` scope.

| Package                                          | Description                                                                      |
| ------------------------------------------------ | -------------------------------------------------------------------------------- |
| [`@enzopita/adonisjs-openapi`](packages/openapi) | Generate an OpenAPI 3.1 document from routes, VineJS validators and transformers |

`playground/` is an AdonisJS API app that the package tests run against. It is not published.

## Develop

```sh
pnpm install
pnpm --filter playground setup:env   # creates playground/.env with an APP_KEY
pnpm test
```

## Release

Add a changeset with `pnpm changeset` in the pull request that changes a package. After the merge, the release workflow opens a "Version packages" pull request. Merging that pull request publishes to npm.
