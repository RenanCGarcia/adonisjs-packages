---
'@enzopita/adonisjs-openapi': major
---

1.0 gives each doc tag form one meaning, takes every error body from a class, and checks the document in CI. The README has a "Migrating from 0.x" guide.

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
- A VineJS `.nullable()` field is in `required` (#31).
- A validator field named `query` is a body field, not a set of query parameters: `request.validateUsing()` passes no `query` key (#20).
- `./types` exports only public types. `RouteOperation` is gone, `GeneratedDocument` and `OpenApiUserConfig` are new, and `OpenApiOperation.tags` is optional.

Also in 1.0:

- `strict` and the `--strict` and `--no-strict` flags make every warning an error in `openapi:generate` and `openapi:check`, except with `--explain`. `generateDocument()` keeps the severity of each diagnostic. `rules.summaryMaxLength` and `rules.summaryTrailingPeriod` check summaries (`OA-S003`, `OA-S004`).
- `openapi:check` reports diagnostics as well as drift, and writes no file, so a git hook can run it.
- A function passed to a route's `.use()` is read like a named middleware (#32). `OA-R003` reports one the app's sources do not have, such as a method, and `OA-R004` one several functions of the app have.
- `openapi:generate --explain=<route>` prints where each response comes from.
- `download()` and `attachment()` get the media type of a literal file extension (#20).
