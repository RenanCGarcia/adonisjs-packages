# @enzopita/adonisjs-openapi

## 1.1.0

### Minor Changes

- [#45](https://github.com/enzopita/adonisjs-packages/pull/45) [`f75a2a0`](https://github.com/enzopita/adonisjs-packages/commit/f75a2a07912e67322c534a48c4a712e56455b4e7) Thanks [@enzopita](https://github.com/enzopita)! - Add an `ErrorCode` enum schema with every literal `code` the app's error responses carry.

- [#46](https://github.com/enzopita/adonisjs-packages/pull/46) [`f395b9c`](https://github.com/enzopita/adonisjs-packages/commit/f395b9cc7fb82c57dfc2511c74d2be2b7532dea3) Thanks [@enzopita](https://github.com/enzopita)! - An `error instanceof A && …` branch of the exception handler now adds its body to the responses of `A`, which still goes on to the next step, instead of joining the generic error body. `errors.throwers` keys now also match calls in the `handle()` of the route's middleware, and the response names that middleware as its source.

- [#51](https://github.com/enzopita/adonisjs-packages/pull/51) [`2d01ae2`](https://github.com/enzopita/adonisjs-packages/commit/2d01ae22e8f01552eee55117feb988fcb067add7) Thanks [@enzopita](https://github.com/enzopita)! - Document the responses of a method or a bound function passed to `.use()`, such as `.use(guard.check)`. The generator finds such a function where V8 says it is declared, through the source map, when no function of the app has its source. `OA-R003` is left for a function neither finds, such as one from a package.

- [#48](https://github.com/enzopita/adonisjs-packages/pull/48) [`b22b6ff`](https://github.com/enzopita/adonisjs-packages/commit/b22b6ffb7d8f9cba32b924c7e365a485aa2d6c75) Thanks [@enzopita](https://github.com/enzopita)! - Read the doc comments of properties: the text becomes `description`, `@example` adds to `examples`, `@default` becomes `default` and `@deprecated` sets `deprecated: true`. `@example {200} name` on an action gives the body of that status an example, read from a `const` holding JSON. A value that cannot be read gets `OA-T009`.

- [#44](https://github.com/enzopita/adonisjs-packages/pull/44) [`bdda613`](https://github.com/enzopita/adonisjs-packages/commit/bdda6132f88962da80bd1fee0ed58e1fed2e9313) Thanks [@enzopita](https://github.com/enzopita)! - Documents the `operationId` rule as stable and adds the `operationId` config function to replace it. Two operations with the same id fail generation with `OA-O001`.

### Patch Changes

- [#47](https://github.com/enzopita/adonisjs-packages/pull/47) [`a458126`](https://github.com/enzopita/adonisjs-packages/commit/a458126b0a3861a5a59a22e0abf38398068ac81e) Thanks [@enzopita](https://github.com/enzopita)! - Stop warning OA-R003 for a middleware passed to `.use()` that an `errors.middleware` key names, such as a `limiter.define()` throttle.

## 1.0.0

### Major Changes

- [#34](https://github.com/enzopita/adonisjs-packages/pull/34) [`6afd4cd`](https://github.com/enzopita/adonisjs-packages/commit/6afd4cdf188caf16267f7b858bfdfabc9e7146ef) Thanks [@enzopita](https://github.com/enzopita)! - 1.0 gives each doc tag form one meaning, takes every error body from a class, and checks the document in CI. The README has a "Migrating from 0.x" guide.

  Breaking changes:

  - The config is grouped by concern: `{ output, document: { info, servers, tags }, routes, security: { schemes, middleware }, errors, strict, rules }`. `defineConfig()` throws on a 0.x key (`info`, `servers`, `tags`, `securitySchemes`, `middlewareSecurity`, `errorResponse`) and names where it went.
  - `@throws {N}`, `@throws {A | B}` and a `@throws` without braces fail generation with `OA-T001`. `@throws {Class}` takes one class, found in scope or by name in `app/**/exceptions/`. A name that no class or several classes have fails with `OA-T002`.
  - `@response {N} reason` only describes a status the generator documents, and fails generation when nothing does (`OA-T003`). `@response {N} {Type} [reason]` declares a status and its body, and fails generation when the type does not resolve (`OA-T007`).
  - A body never comes from a status code. An exception's body is what an `instanceof` branch of the exception handler renders for its class, else the exception's own, else the handler's generic body. Exceptions thrown inside packages are named in `errors.throwers` (by call, such as `bouncer.authorize` or `findOrFail`) and `errors.middleware` (by middleware name, such as `globalThrottle`). `errors.body` replaces `errorResponse`.
  - The `401` of a secured route is the response of `E_UNAUTHORIZED_ACCESS`, so an exception handler branch for it gives its body.
  - An operation without `@tags` has no tags and gets `OA-S001`, instead of a tag from its route name. A tag that `document.tags` does not declare gets `OA-S002`.
  - `output` is the only document path. `openapi:generate --output` and the `file` option of `openapiRoutes()` are removed. The build hook runs `openapi:generate --no-strict`, so a warning never fails a build, and copies `output` into the build. `node ace add` no longer edits `metaFiles`.
  - `generateDocument()` returns `{ document, diagnostics, provenance }`. Each diagnostic has `code`, `severity`, `route`, `message`, `fix` and `location`, instead of a warning string.
  - The first paragraph of the doc comment of an app's middleware or exception class describes the responses it produces, instead of the status text. A response that only comes from such a class is a `$ref` to `components.responses`, named after the class whatever the order of the routes.
  - A VineJS `.nullable()` field is in `required` ([#31](https://github.com/enzopita/adonisjs-packages/issues/31)).
  - A validator field named `query` is a body field, not a set of query parameters: `request.validateUsing()` passes no `query` key ([#20](https://github.com/enzopita/adonisjs-packages/issues/20)).
  - `./types` exports only public types. `RouteOperation` is gone, `GeneratedDocument` and `OpenApiUserConfig` are new, and `OpenApiOperation.tags` is optional.

  Also in 1.0:

  - `strict` and the `--strict` and `--no-strict` flags make every warning an error in `openapi:generate` and `openapi:check`, except with `--explain`. `generateDocument()` keeps the severity of each diagnostic. `rules.summaryMaxLength` and `rules.summaryTrailingPeriod` check summaries (`OA-S003`, `OA-S004`).
  - `openapi:check` reports diagnostics as well as drift, and writes no file, so a git hook can run it.
  - A function passed to a route's `.use()` is read like a named middleware ([#32](https://github.com/enzopita/adonisjs-packages/issues/32)). `OA-R003` reports one the app's sources do not have, such as a method, and `OA-R004` one several functions of the app have.
  - `openapi:generate --explain=<route>` prints where each response comes from.
  - `download()` and `attachment()` get the media type of a literal file extension ([#20](https://github.com/enzopita/adonisjs-packages/issues/20)).

### Minor Changes

- [#29](https://github.com/enzopita/adonisjs-packages/pull/29) [`1aeac99`](https://github.com/enzopita/adonisjs-packages/commit/1aeac99a1356b7f33f8e93b40465b7c9a371714d) Thanks [@enzopita](https://github.com/enzopita)! - `generateDocument()` returns `diagnostics` (`code`, `severity`, `route`, `message`, `fix`, `location`) instead of `warnings: string[]`, and `provenance`, which records where each response of each route comes from. `openapi:generate --explain=<route>` prints that provenance, and the new `openapi:check` command fails when the committed document is out of date. The generated document is unchanged.

### Patch Changes

- [#29](https://github.com/enzopita/adonisjs-packages/pull/29) [`1aeac99`](https://github.com/enzopita/adonisjs-packages/commit/1aeac99a1356b7f33f8e93b40465b7c9a371714d) Thanks [@enzopita](https://github.com/enzopita)! - An absolute `output` is written as given, instead of below the app root ([#27](https://github.com/enzopita/adonisjs-packages/issues/27)).

## 0.4.2

### Patch Changes

- [#25](https://github.com/enzopita/adonisjs-packages/pull/25) [`7783769`](https://github.com/enzopita/adonisjs-packages/commit/778376986b8af029da885ca9d1abb68217a0da84) Thanks [@enzopita](https://github.com/enzopita)! - A numeric `@throws {status}` adds the exception handler's body only when the action sends no body of its own for that status. In 0.4.1 it also added that body next to an exception the action throws, such as a `409` with its own body, which documented bodies the route never sends.

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
