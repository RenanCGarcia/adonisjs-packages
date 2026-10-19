# @enzopita/adonisjs-openapi

## 0.2.0

### Minor Changes

- [#8](https://github.com/enzopita/adonisjs-packages/pull/8) [`5096bdf`](https://github.com/enzopita/adonisjs-packages/commit/5096bdfb9bdc226ac2314f803c269fadab564473) Thanks [@enzopita](https://github.com/enzopita)! - Serve the document on a docs page with Scalar, Swagger UI or Redoc through `openapiRoutes()` from `@enzopita/adonisjs-openapi/routes`, and write it during `node ace build` with the `@enzopita/adonisjs-openapi/build_hook` build hook.

- [#5](https://github.com/enzopita/adonisjs-packages/pull/5) [`6cbc990`](https://github.com/enzopita/adonisjs-packages/commit/6cbc9901993d95e6d0e58cfae8477168e091961c) Thanks [@enzopita](https://github.com/enzopita)! - Operations and responses now carry more of what the app already says, still with no annotations to import:

  - The doc comment on a controller method gives the operation its `summary`, `description` and `deprecated` flag. `@tags` sets its tags, on the method or on the class, and `@throws {404} User not found` adds a response.
  - Status codes come from the response helper the handler returns, such as `response.created()` or `response.noContent()`, with or without Tuyau installed. Bodyless responses such as `204` have no `content`.
  - Routes behind a middleware mapped in `middlewareSecurity` get a `401` response.
  - The transformer types in `.adonisjs/client/data.d.ts` become named schemas in `components.schemas`, referenced with `$ref`. The `422` body is the shared `ValidationError` schema.
  - The config accepts top-level `tags` and the full OpenAPI Info Object (`summary`, `termsOfService`, `contact`, `license`).

### Patch Changes

- [#8](https://github.com/enzopita/adonisjs-packages/pull/8) [`5096bdf`](https://github.com/enzopita/adonisjs-packages/commit/5096bdfb9bdc226ac2314f803c269fadab564473) Thanks [@enzopita](https://github.com/enzopita)! - Importing the package no longer loads the TypeScript compiler and `@adonisjs/assembler`, so `config/openapi.ts` no longer pulls them in when the app boots. `generateDocument()` loads them on its first call.

- [#8](https://github.com/enzopita/adonisjs-packages/pull/8) [`5096bdf`](https://github.com/enzopita/adonisjs-packages/commit/5096bdfb9bdc226ac2314f803c269fadab564473) Thanks [@enzopita](https://github.com/enzopita)! - Named closure routes are left out of the document, like unnamed ones, because they have no types to read.

## 0.1.0

### Minor Changes

- [`9b0b62e`](https://github.com/enzopita/adonisjs-packages/commit/9b0b62eb5668144d3e72e14638b4994b774d0ad0) Thanks [@enzopita](https://github.com/enzopita)! - First release: `node ace openapi:generate` writes an OpenAPI 3.1 document from the routes, VineJS validators and transformers of an AdonisJS 7 app.
