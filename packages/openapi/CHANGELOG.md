# @enzopita/adonisjs-openapi

## 0.4.1

### Patch Changes

- [#23](https://github.com/enzopita/adonisjs-packages/pull/23) [`7845c56`](https://github.com/enzopita/adonisjs-packages/commit/7845c56a51c5746196b3c6d7861f1bada5334769) Thanks [@enzopita](https://github.com/enzopita)! - A numeric `@throws {403}` on a status that a route middleware also answers now adds the body the exception handler renders for that status to the `oneOf`, instead of keeping only the middleware bodies.

## 0.4.0

### Minor Changes

- [#18](https://github.com/enzopita/adonisjs-packages/pull/18) [`8ecacaf`](https://github.com/enzopita/adonisjs-packages/commit/8ecacaffba383370812cda4e5dfb3cbdbd06959e) Thanks [@enzopita](https://github.com/enzopita)! - Document error bodies and resolve `@throws` classes without importing them:

  - Every error status without a body of its own, such as `@throws {404}` or the `401` of a secured route, gets the body the app's exception handler sends, as the `Error` schema. `errorResponse` in the config overrides it.
  - A route middleware that answers with a status, such as `response.badRequest(body)` in a tenant middleware, documents that response.
  - `@throws {import('#exceptions/x').default}` and `@requestBody {import('#types/x').Name}` resolve a type without an import in the controller.
  - A `@throws` reason that wraps lines is joined into one line, the reasons of several tags on one status code are joined, and identical bodies in a `oneOf` appear once.

  Document responses, schemas and parameters as the app sends them:

  - Branches that answer with the same status code are merged into a `oneOf`. `return null` is a `204`, `response.redirect()` a `302` with a `Location` header, and `response.json()` keeps the status set before it.
  - The handler's own response calls are read: `send()` or a helper without `return`, `abort()`, `abortIf()`, `abortUnless()`, `download()`, `attachment()` and `stream()`, and the headers it sets with a literal name. A string body is `text/plain`, or the literal `content-type` the handler sets.
  - An exception thrown with `throw new X()` in a handler or a middleware documents its response. The `401` of a secured route gets the body of `E_UNAUTHORIZED_ACCESS`.
  - A handler that only answers with errors no longer gets a `200`.
  - A Lucid model becomes `{}` with a warning. `Map` and `Set` are empty objects, `bigint` is a string, and properties typed `undefined` or keyed by a symbol are left out.
  - An object query parameter uses `style: deepObject`, an optional path parameter documents both paths, and each method of a route reads its own input.
  - A `HEAD`-only route is left out, and a skipped closure route logs a warning.

## 0.3.0

### Minor Changes

- [#14](https://github.com/enzopita/adonisjs-packages/pull/14) [`c6e7d5f`](https://github.com/enzopita/adonisjs-packages/commit/c6e7d5f58f2a25d702f9ac0e559f502ed5703ac3) Thanks [@enzopita](https://github.com/enzopita)! - Document an exception's response with `@throws {ExceptionClass}`, which reads the class's `static status` and the return type of its `toResponse()` method, and a request body read without a validator with `@requestBody {TypeName}`. A status code with several bodies, such as an exception's `422` on a validated route, is a `oneOf` of them. A union, `@throws {AException | BException}`, documents each class under its own status code. When the class has no literal `static status` or no `toResponse()`, the status and body come from what its `handle()` answers with: a response helper such as `response.conflict(body)`, or `response.status(...)` and `response.send(...)`, also inside the app's functions it calls. A `@throws` or `@requestBody` tag that can't be documented is reported as a warning.

## 0.2.1

### Patch Changes

- [#10](https://github.com/enzopita/adonisjs-packages/pull/10) [`13ee47c`](https://github.com/enzopita/adonisjs-packages/commit/13ee47c271cb6b6266367feee2b97652ceff1342) Thanks [@enzopita](https://github.com/enzopita)! - A route behind several middleware mapped in `middlewareSecurity` now requires all their schemes together, in one Security Requirement Object. Before, each scheme was a separate entry of `security`, so the document listed them as alternatives.

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
