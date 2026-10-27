# @enzopita/adonisjs-openapi

Generate an OpenAPI 3.1 document from an AdonisJS 7 app, with no annotations. The generator reads the same sources as [Tuyau](https://github.com/Julien-R44/tuyau):

| OpenAPI                             | Source                                                                                                 |
| ----------------------------------- | ------------------------------------------------------------------------------------------------------ |
| Paths and operations                | Named routes from the router                                                                           |
| Request body, query and path params | The VineJS validator passed to `request.validateUsing()` (formats, bounds and enums included)          |
| Responses                           | The return type of the controller method, such as `serialize(UserTransformer.transform(user))`         |
| Status codes                        | Response helpers such as `response.created()`, the exceptions the action throws, and its middleware    |
| `summary`, `description`, `tags`    | The doc comment on the controller method and its class                                                 |
| Response descriptions               | The doc comment on the middleware or exception class a response comes from, or a doc tag on the action |
| Named schemas                       | The transformer types `node ace codegen` writes to `.adonisjs/client/data.d.ts`                        |
| `422` response                      | Added to every route that validates its input                                                          |
| `401` response and `security`       | Named middleware on the route, mapped in the config                                                    |

Controllers, validators and transformers import nothing from this package. Everything it reads is code an AdonisJS app already has, or a doc comment.

## Install

```sh
node ace add @enzopita/adonisjs-openapi
```

The command installs the package and creates `config/openapi.ts`. In `adonisrc.ts`, it registers the ace command and the build hook that writes the document during `node ace build` and ships it with the build. The package needs `@adonisjs/assembler`, which every AdonisJS app has as a dev dependency.

## Generate the document

```sh
node ace openapi:generate
```

The command boots the app the way `node ace codegen` does, so no database connection or queue worker starts. It writes the document to `output` from the config, `openapi.json` at the app root by default. An absolute `output` is used as given.

The command prints a [diagnostic](#diagnostics) for each problem it finds. A diagnostic starts with a stable code, such as `OA-R002`, and names the route and the source line when it has one. An `error` diagnostic, such as a `@throws {404}`, fails the command, and no file is written. A `warning` does not, unless the config sets `strict: true` or you pass `--strict`. `--no-strict` turns a `strict` config off for one run.

To see where each response of a route comes from, pass the route name to `--explain`. The command prints the sources and writes no file, so a warning does not fail it, even with `strict`:

```sh
node ace openapi:generate --explain=users.users.show
# 200
#   the handler's return type (app/controllers/users_controller.ts:32)
# 404
#   findOrFail() throws E_ROW_NOT_FOUND (app/controllers/users_controller.ts:35)
#   a @response tag (app/controllers/users_controller.ts:30)
# 422
#   the validator rejects the input
```

`generateDocument(app, router, config)` returns the same result to code, such as a test of the app: `document`, `diagnostics` (`code`, `severity`, `route`, `message`, `fix`, `location`) and `provenance`, the sources `--explain` prints. It ignores `strict`: each diagnostic keeps its own severity, and the caller decides what fails.

### Check the committed document

```sh
node ace openapi:check
```

The command generates the document in memory and compares it with the file at `output`. It fails with exit code `1` when the file is missing, when the two differ, or when a diagnostic is an error. When they differ, it lists the JSON Pointers that changed. It prints the diagnostics like `openapi:generate`, takes the same `--strict` and `--no-strict` flags, and writes no file.

`openapi:check` compares against the committed file, so commit `output`. A client generated from that file, such as one orval writes, then changes only when the document does.

### Run the check in CI and in a git hook

In CI, run the check after installing the dependencies:

```sh
node ace openapi:check --strict
```

Before a push, [lefthook](https://lefthook.dev) can run it when the push touches a file the document comes from:

```yaml
# lefthook.yml
pre-push:
  commands:
    openapi:
      glob: '{app/**,start/**,config/openapi.ts,adonisrc.ts,package.json,openapi.json}'
      run: node ace openapi:check --strict
```

The glob lists the sources of the document, `adonisrc.ts` for the named schemas, `package.json` for package upgrades, and the committed document itself, so a hand edit to it is checked too. Replace `openapi.json` with your `output`, and add your lockfile to the glob.

When the hook fails, run `node ace openapi:generate`, commit `output`, and push again.

## Configure

```ts
// config/openapi.ts
import { errors as lucidErrors } from '@adonisjs/lucid'
import { errors as bouncerErrors } from '@adonisjs/bouncer'
import { errors as limiterErrors } from '@adonisjs/limiter'
import { defineConfig } from '@enzopita/adonisjs-openapi'

export default defineConfig({
  output: 'openapi.json',
  document: {
    info: {
      title: 'Acme API',
      version: '1.0.0',
      license: { name: 'MIT', identifier: 'MIT' },
    },
    servers: [{ url: 'https://api.acme.test' }],
    tags: [{ name: 'Users', description: 'Public user profiles' }],
  },
  routes: { except: ['admin.'] },
  security: {
    schemes: {
      accessToken: { type: 'http', scheme: 'bearer' },
    },
    middleware: {
      auth: 'accessToken',
    },
  },
  errors: {
    throwers: {
      'bouncer.authorize': bouncerErrors.E_AUTHORIZATION_FAILURE,
      'findOrFail': lucidErrors.E_ROW_NOT_FOUND,
    },
    middleware: { globalThrottle: limiterErrors.E_TOO_MANY_REQUESTS },
  },
  strict: false,
  rules: { summaryMaxLength: 60, summaryTrailingPeriod: false },
})
```

Every key is optional. `defineConfig()` throws when the config sets a 0.x key, such as `info` or `securitySchemes`, and names where it went.

| Key                   | Default                              | Description                                                                                                                                                                          |
| --------------------- | ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `output`              | `'openapi.json'`                     | The document file, relative to the app root or absolute. `openapi:generate` writes it, `openapi:check` and `openapiRoutes({ source: 'file' })` read it, and the build hook ships it. |
| `document.info`       | `{ title: 'API', version: '1.0.0' }` | The OpenAPI Info Object: `title` and `version`, and optionally `summary`, `description`, `termsOfService`, `contact` and `license`.                                                  |
| `document.servers`    | `[]`                                 | The document's `servers`.                                                                                                                                                            |
| `document.tags`       | `[]`                                 | The document's top-level `tags`, which describe and order the OpenAPI tags of the operations. An OpenAPI tag an operation uses must be declared here, or it gets `OA-S002`.          |
| `routes`              | `{}`                                 | `only` or `except`, with the same matchers as Tuyau's `generateRegistry()`: a substring, a regular expression, or a function of the route name.                                      |
| `security.schemes`    | `{}`                                 | The document's `components.securitySchemes`.                                                                                                                                         |
| `security.middleware` | `{}`                                 | Maps a named middleware, such as `middleware.auth()`, to a key of `security.schemes`. See [Security](#security).                                                                     |
| `errors`              | `{}`                                 | The exceptions thrown inside packages, and the error body. See [Errors config](#errors-config).                                                                                      |
| `strict`              | `false`                              | Makes every warning an error in `openapi:generate` and `openapi:check`. The `--strict` and `--no-strict` flags override it. The build hook and `--explain` ignore it.                |
| `rules`               | `{}`                                 | `summaryMaxLength` warns about a longer summary (`OA-S003`). `summaryTrailingPeriod: true` warns about a summary without a final period, `false` about one with it (`OA-S004`).      |
| `operationId`         | not set                              | A function that replaces the `operationId` of every operation. See [Operation ids](#operation-ids).                                                                                  |

### Operation ids

Client generators such as orval name their functions after `operationId`, so the rule that builds it is part of the contract. The default rule is stable and changes only in a major release:

- The id is the route name, such as `users.show`.
- The path without an optional parameter adds `.without_<param>`, such as `users.show.without_id`.
- A route that answers several methods adds `.<method>` last, such as `probe.echo.get` and `probe.echo.post`.

To choose the ids yourself, set `operationId`. It replaces the whole rule, and the generator calls it once for each method of each path, with the route `name`, the lowercase `method`, and the OpenAPI `path`, such as `/users/{id}`:

```ts
export default defineConfig({
  operationId: ({ name, method }) => `${name}.${method}`,
})
```

Two operations with the same id fail generation with `OA-O001`, which names the first one. An empty id throws.

### Security

Routes behind a middleware that `security.middleware` maps get its scheme in `security` and a `401` response. A route behind several mapped middleware, such as `middleware.auth()` and `middleware.tenant()`, requires all their schemes together: they share one Security Requirement Object.

### Errors config

The generator follows `throw new X()` in the app's code. It does not read package code, so `errors` names what packages throw:

- `errors.throwers` names the exception a call throws inside a package. Calls are matched in the action and in the functions of the app it calls. The response is the one of the class, see [Error bodies](#error-bodies). A key is matched against the last names of the call. A call in the middle of the chain drops its method name and keeps its receiver:
  - `findOrFail` matches any call of a method named `findOrFail`.
  - `bouncer.authorize` matches `bouncer.authorize()`, `ctx.bouncer.authorize()` and `bouncer.with(PostPolicy).authorize()`, which reads as `bouncer.authorize`.
  - `failures.consume` matches `failures.consume(key)`, where `failures` is the local name of the receiver, whatever its type.
  - `this.getBouncer().authorize()` reads as `this.authorize`, and `bouncerFor(user).authorize()` as `bouncerFor.authorize`, so `bouncer.authorize` matches neither.
- `errors.middleware` names the exception a middleware throws inside a package. The key is the middleware's name as `node ace list:routes` shows it: a named middleware, such as `auth`, or the name of a function middleware, such as the `globalThrottle` that `limiter.define('global', ...)` returns. It can also be a specifier in `start/kernel.ts`. The generator matches names and loads no module to do it.
- `errors.body` is the body of an error the exception handler renders without a branch for its class, as a type expression such as `"import('#types/api').ApiError"`. Without it, that body is read from the exception handler.

A `throwers` or `middleware` key that matches nothing in the documented routes, such as a misspelled `bouncer.authorise`, gets `OA-E003`. An entry's status is read from the source of its class, which the generator never runs: a numeric `status` field, `static status`, the `status` its constructor sets, or the one of a class it extends. A package class is read from its JavaScript, since its declaration file only says `status: number`. An entry whose status cannot be read gets `OA-E001` and is ignored.

A thrower key matches every call of that method. A `findOrFail()` on a row that a foreign key or a validator guarantees still documents its `404`. The response is true, because a concurrent delete can send it, and `@response` cannot remove it. Remove the key to drop it from every route.

## Document an operation

The generator reads the doc comment on the controller method, the same way the NestJS Swagger plugin does:

```ts
/**
 * @tags Users
 */
export default class UsersController {
  /**
   * Show a user
   *
   * Looks the user up by its numeric id.
   *
   * @response {404} User not found
   */
  async show({ request, serialize }: HttpContext) {
    const { params } = await request.validateUsing(showUserValidator)

    return serialize(UserTransformer.transform(await User.findOrFail(params.id)))
  }
}
```

The first paragraph is the `summary`. The next paragraphs and `@remarks` are the `description`.

A doc tag is an `@` line of the doc comment, such as `@response {404} User not found`. The generator reads six doc tags, and each form of a doc tag has one meaning. `@response` has two forms, told apart by what follows the status code: a reason alone describes a response the generator documents, and a `{Type}` declares a response with that body.

| Doc tag form                      | Meaning                                                                                                                                                                          |
| --------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `@tags Users, Admin`              | The operation's OpenAPI tags, which group operations in a docs page. On the class, they apply to every method. A method's own `@tags` replaces the class tags.                   |
| `@response {404} reason`          | Describes a status the generator already documents, such as the `404` of `findOrFail()`. It never adds a body. When nothing documents that status, generation fails (`OA-T003`). |
| `@response {502} {Type} [reason]` | Declares a status and its body that nothing can derive, such as an upstream error the handler relays.                                                                            |
| `@throws {Class} [reason]`        | Adds the status and the body of an exception class, which the reason describes for this operation. See [Exception responses](#exception-responses).                              |
| `@requestBody {Type}`             | The request body schema, for a handler that reads the body without a validator, such as a webhook. It replaces the body the validator would document.                            |
| `@deprecated`                     | Marks the operation as deprecated.                                                                                                                                               |
| `@remarks`                        | Adds a paragraph to the `description`.                                                                                                                                           |

Prefer what the generator derives over a doc tag. An exception the action throws with `throw new`, a call `errors.throwers` names, and a middleware of the route document their status without a doc tag. Use `@response {N} reason` to describe such a status for one action, and describe it once on its class for every action, see [Describe a response once](#describe-a-response-once). Use `@throws {Class}` for an exception that the generator cannot see thrown, and `@response {N} {Type}` only when no class exists, such as a body the handler relays from another service.

- A `{Type}` is a name in scope in the controller file, or `{import('#types/api').UpstreamError}`. A type that does not resolve fails generation with `OA-T007`, and so does an inline object type such as `{{ provider: string }}`: declare it as a type and name it.
- `@throws {Class}` takes one class. A class in scope in the controller file is used as is. Any other is found by name among the classes extending `Exception` in the app's `app/**/exceptions/` folders, so it needs no import. A name that two classes share, or that none has, fails generation with `OA-T002`. `{import('#exceptions/user_disabled_exception').default}` names a class by its module, and works for any export: `import('#exceptions/errors').E_LOCKED`.
- `@throws {404}`, `@throws {A | B}` and a tag without braces, such as `@throws EmailTakenException`, fail generation with `OA-T001`, which names the fix.
- The reason of a doc tag replaces the description for that operation. When several doc tags document one status code, their reasons are joined with `; `.
- An operation without `@tags` has no OpenAPI tags and gets `OA-S001`.
- A doc tag the generator does not read, such as a misspelled `@reponse`, gets `OA-T008`. Standard doc tags for the readers of the code are ignored without one: `@param`, `@returns`, `@return`, `@see`, `@example`, `@since`, `@internal`, `@todo`, `@override`, `@inheritDoc`, `@author`, `@version`, `@alpha`, `@beta`, `@experimental`, `@public`, `@private` and `@protected`. `@summary`, `@description` and `@exception` get the warning, with where their content goes instead.

## Describe a response once

The first paragraph of the doc comment of a middleware or an exception class describes every response that class produces:

```ts
/**
 * The X-Tenant-Id header is missing
 */
export default class TenantMiddleware {
  async handle(ctx: HttpContext, next: NextFn) {
    if (!ctx.request.header('x-tenant-id')) {
      return ctx.response.badRequest({
        code: 'E_INVALID_TENANT_HEADER' as const,
        message: 'Missing X-Tenant-Id header',
      })
    }

    return next()
  }
}
```

A response that comes only from such a class goes to `components.responses`, under the name of the class, and each operation references it:

```json
"400": { "$ref": "#/components/responses/TenantMiddleware" }
```

- A response a middleware sends belongs to the middleware. A response an exception sends belongs to the exception class, also when a middleware throws it.
- `@response {N} reason` or `@throws {Class} reason` on the action describes the response inline for that operation instead.
- When several sources share a status, such as a middleware's `403` and the `403` of `bouncer.authorize()`, the response stays inline. Its description joins the reasons of their classes, and the status text stands for the sources without one: `The email address of the account is not verified; Forbidden`.
- Classes from packages, inline middleware, the handler's own responses, the `401` of a secured route and the `422` of the validator have no reason, so their responses keep the status text.
- A name depends only on the responses of the document, not on the order of the routes. A class exported as `export default class extends Exception {}` is named after its file: `plan_frozen_exception.ts` gives `PlanFrozenException`. When different responses would take one name, each is named after its status code too, such as `LimitException_402`. When that is still not enough, because two classes share a name and a status, each is named after the module of its class too, such as `app.exceptions.billing.limit_exception.LimitException_402`.

## Exception responses

An exception class named by `@throws` documents its status code and its body:

- A response helper that `handle()` calls, such as `response.conflict(body)` or `response.unprocessableEntity(body)`, adds its status code and body.
- A `response.send(...)` or `response.json(...)` call adds a response with the status code of `static status`, on the class or a parent class: a number such as `422`, `422 as const`, a constant or an enum member. Without one, the code passed to `response.status(...)` is used. The body is the return type of an instance method named `toResponse()` or, without it, the type of what each call sends.
- A class whose `handle()` sends nothing still adds the response of its `static status`, with `toResponse()` as the body when it has one.

`handle()` is read with the functions of the app it calls, such as a shared `renderError(ctx, error)`. Functions from packages are not followed, and only calls on an `HttpResponse` count.

The handler does not need `@throws` for an exception it throws itself: `throw new EmailTakenException(email)` in the handler, or in a function of the app it calls, documents the class's response the same way.

```ts
export default class SmsRejectedException extends Exception {
  static override status = 422
  static override code = 'E_SMS_REJECTED'

  constructor(public reason: string) {
    super('The SMS was rejected')
  }

  toResponse() {
    return { code: 'E_SMS_REJECTED' as const, message: this.message, reason: this.reason }
  }

  async handle(error: this, { response }: HttpContext) {
    response.status(error.status).send(error.toResponse())
  }
}
```

An exception can also leave both to `handle()`:

```ts
export default class EmailTakenException extends Exception {
  async handle(error: this, { response }: HttpContext) {
    response.conflict({ code: 'E_EMAIL_TAKEN' as const, message: error.message })
  }
}
```

When several exceptions share a status code, or an exception uses `422` on a route that validates its input, the body schema is a `oneOf` of each distinct body and `ValidationError`.

A class from a package, such as `E_ROW_NOT_FOUND` from `@adonisjs/lucid`, is thrown inside the package, which the generator does not read. Name the call that throws it in `errors.throwers`, and its status is read from the package's JavaScript.

## Error bodies

The body of an exception comes from its class, never from its status code. The generator reads the exception handler `start/kernel.ts` registers with `server.errorHandler()`, or `#exceptions/handler`, in the order the framework runs it:

```ts
export default class HttpExceptionHandler extends ExceptionHandler {
  async handle(error: unknown, ctx: HttpContext) {
    if (error instanceof bouncerErrors.E_AUTHORIZATION_FAILURE) {
      return ctx.response.status(error.response.status || error.status).send({
        code: 'E_AUTHORIZATION_FAILURE' as const,
        message: error.getResponseMessage(ctx),
      })
    }

    return super.handle(error, ctx)
  }

  override async renderErrorAsJSON(error: Exception, ctx: HttpContext) {
    ctx.response
      .status(error.status)
      .send({ code: error.code ?? 'E_UNKNOWN', message: error.message })
  }
}
```

1. An `if (error instanceof X)` branch of `handle()` gives the body of the class `X` and of the classes extending it. A condition of `instanceof` checks joined by `||`, such as `error instanceof A || error instanceof B`, makes a branch for each class. A condition that checks anything else, such as a `code`, makes no branch. A branch that sends nothing, such as one that only sets a header before `super.handle()`, does not count: the next step gives the body.
2. Else an exception with a `handle()` of its own sends its body, see [Exception responses](#exception-responses). A package exception that renders its own body, such as `E_INVALID_CREDENTIALS`, is documented without one and gets the `OA-E002` warning: render it in a branch of `handle()`.
3. Else an `instanceof` branch of `renderErrorAsJSON()` gives the body.
4. Else the exception gets what `handle()` and `renderErrorAsJSON()` send outside their branches with the status of the error, or `errors.body` when the config sets it. It becomes the `Error` schema in `components.schemas`. A handler that overrides neither sends the framework's `{ message: string }`.

The `401` of a secured route is the response of `E_UNAUTHORIZED_ACCESS` from `@adonisjs/auth`, resolved in the same order: a branch of `handle()` for it gives the body. Without one, the body is the `{ errors: [{ message }] }` its own `handle()` sends a client that accepts JSON, which the generator knows although the package does not declare it.

## Middleware responses

A middleware that ends the request documents its response on every route it runs on: the named middleware a route uses, the ones `router.use()` and `server.use()` register in `start/kernel.ts`, and a function passed to the route's `.use()`. Its `handle()`, or the function, is read like an exception's, so `response.forbidden(body)` or `response.status(403).send(body)` adds a `403` with that body. An exception it throws, such as `throw new TwoFactorRequiredException()`, adds the response of that class, and `response.abort()` and `response.redirect()` add theirs. Middleware from packages are not read: name what they throw in `errors.middleware`.

```ts
router
  .get('health/ready', [HealthChecksController, 'ready'])
  .use(async ({ request, response }, next) => {
    if (request.header('x-monitoring-secret') !== env.get('MONITORING_SECRET')) {
      return response.unauthorized({ code: 'E_UNAUTHORIZED_ACCESS' as const, message: 'Denied' })
    }

    return next()
  })
```

The generator finds a function passed to `.use()` in the app's sources by the source it has at runtime. It compares every token of the parameters and the body, operators, keywords and literals included, once the types are erased. Semicolons, commas and parentheses are left out, because the compiler that runs the app adds and drops them. `--explain` names the function as `node ace list:routes` does: by its function name, or `closure`.

The responses of the function are not documented, and a warning tells why, when:

- No function of the app's sources has its source (`OA-R003`). This is the case for a method, such as `.use(guard.check)`, a bound function, a function from a package, and a function that uses syntax the compiler rewrites, such as an `enum`.
- Several functions of the app's sources have its source (`OA-R004`), such as the same closure in two files that import a different class under the same name. The warning lists them.

Register such a middleware as a named middleware, or make the functions differ.

## Status codes

A response comes from each status code the handler can answer with. Branches that share a status code are merged, with a `oneOf` of their bodies:

- `return serialize(...)` or a plain object is a `200`, or the status of a `response.status(201)` called before it. `return response.json(body)` works the same way.
- `return response.created(await serialize(...))` is a `201` with the serialized body. Every `HttpResponse` helper that sets a 2xx, 4xx or 5xx status works this way, such as `noContent()`, `accepted()` or `notFound(body)`. This uses the same types Tuyau adds to `HttpResponse`, and works without Tuyau too.
- A helper or `response.send(body)` called without `return` counts too, since the handler's own response calls are read along with its return type.
- `return null` is a `204` with no body. When the return type also includes `undefined`, the description says the response can have no body.
- `response.redirect(...)` is a `302`, or the status passed to it, with a `Location` header.
- `response.abort(body, 403)`, `abortIf()` and `abortUnless()` add their status with that body, or `400` without a status.
- `204`, `205` and `304` responses, and helpers called without a body, have no `content`.
- The exceptions the handler throws, its middleware, `@throws` and `@response {N} {Type}`, its validator (`422`) and its security middleware (`401`) add statuses too. See [Exception responses](#exception-responses), [Middleware responses](#middleware-responses), [Document an operation](#document-an-operation) and [Security](#security).
- A handler with no typed answer gets a `200` with no schema and a warning. A handler that only answers with errors, such as `return response.tooManyRequests(body)`, gets no `200`.

## Media types and headers

- A returned string is sent as `text/plain`. A literal `response.header('content-type', 'text/csv')` in the handler replaces the media type of its bodies.
- `response.download()` and `attachment()` are documented with `format: binary` and the media type of the file's extension, as the app sends it, when the path is a string literal or a template literal that ends with the extension, such as `` `exports/${name}.csv` ``. Any other path, and `stream()`, are documented as `application/octet-stream`. `attachment()` adds a `Content-Disposition` header.
- A header the handler sets with a literal name, such as `response.header('Retry-After', '10')`, is documented on every response the handler sends, but not on the response of an exception it throws.

## Named schemas

When `.adonisjs/client/data.d.ts` exists, every type in its `Data` namespace becomes a schema in `components.schemas`, named by its path below `Data`: `User`, or `Admin.User` for a nested namespace. Responses reference them with `$ref`, including items of a collection and transformers nested in an object passed to `serialize()`. The `422` body is the `ValidationError` schema.

`node ace codegen` writes that file when `indexEntities()` in `adonisrc.ts` has transformers enabled. Without it, schemas are inlined.

## How types become schemas

- A route must have a name and a controller handler. Closure routes are skipped with `OA-R001`, except the ones `openapiRoutes()` registers.
- `request.validateUsing()` validates the request body merged with the query string, plus `params`, `headers` and `cookies`. On `GET` and `OPTIONS` operations, the validator fields become query parameters. On other methods they become the body, and the `params` object becomes the path parameters. A route that answers `GET` and `POST` gets one of each.
- A validator field named `query` is a field like any other, which the app reads from `?query[page]=2` or from the body. It does not document `?page=2`.
- An object query parameter uses `style: deepObject`, as the app reads `filter[status]=x`. The app reads an array only from a repeated key, `?tags=a&tags=b`.
- A field is required unless it is `.optional()`. A `.nullable()` field is required, with `null` in its type.
- An optional path parameter, `/users/:id?`, documents both `/users` and `/users/{id}`. The shorter path's `operationId` ends with `.without_id`, see [Operation ids](#operation-ids).
- A `HEAD`-only route is left out.
- A body with a `vine.file()` field is sent as `multipart/form-data`.
- When VineJS cannot describe a field (a file, a custom rule), the generator uses the field's TypeScript type.
- `Date` and Luxon `DateTime` values become `{ type: 'string', format: 'date-time' }`.
- `Map` and `Set` become an empty object and `bigint` a string, as they serialize. Symbol keys and properties typed `undefined` are left out.
- A Lucid model returned directly becomes `{}` with `OA-J002`, because its type does not describe what `serialize()` sends. Return it through a transformer.

## Diagnostics

Codes keep their meaning across releases. An `error` fails `openapi:generate` and `openapi:check`. A `warning` fails them only with `strict` or `--strict`.

| Code      | Severity                                          | Reported when                                                                                                                     | Fix                                                                                                                                             |
| --------- | ------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| `OA-R001` | warning                                           | A closure route, which has no types to read. The route is skipped.                                                                | Move the handler to a controller.                                                                                                               |
| `OA-R002` | warning                                           | A handler whose return type is unknown. It gets a `200` with no schema.                                                           | Return `serialize(...)` or a typed value.                                                                                                       |
| `OA-R003` | warning                                           | A function passed to `.use()` that no function of the app's sources matches. Its responses are not documented.                    | Pass an arrow function or a function the app declares, or register it as a named middleware. See [Middleware responses](#middleware-responses). |
| `OA-R004` | warning                                           | A function passed to `.use()` that several functions of the app's sources match. It lists them. Its responses are not documented. | Make the functions differ, or register the middleware as a named middleware.                                                                    |
| `OA-V001` | warning                                           | A validator whose JSON Schema cannot be read.                                                                                     | Check that the module exports a VineJS validator.                                                                                               |
| `OA-T001` | error                                             | A `@throws` that names a status code, a union, or a class without braces.                                                         | `@response {N} reason`, `@response {N} {Type}`, or one `@throws {Class}` per class.                                                             |
| `OA-T002` | error                                             | A `@throws` class name that no exception class of the app has, or that several have. It lists them.                               | Fix the name, or name the class as `import('...').default`.                                                                                     |
| `OA-T003` | error                                             | A `@response {N} reason` whose status nothing documents.                                                                          | Add the `errors.throwers` entry that derives it, declare the body with `@response {N} {Type}`, or remove the tag.                               |
| `OA-T004` | warning                                           | A `@response` whose status is not a status code.                                                                                  | Write `@response {404} reason`.                                                                                                                 |
| `OA-T005` | warning                                           | A `@throws` type that is not a class, or does not resolve.                                                                        | Import the class, or name it as `import('...').Export`.                                                                                         |
| `OA-T006` | warning                                           | A `@throws` class with no status code.                                                                                            | Give it a literal `static status`, or answer with a helper such as `response.conflict(body)` in its `handle()`.                                 |
| `OA-T007` | error for `@response`, warning for `@requestBody` | A type that does not resolve, or an inline object type.                                                                           | Declare it as a named type in scope, or name it as `import('...').Type`.                                                                        |
| `OA-T008` | warning                                           | A doc tag the generator does not read, such as `@reponse`.                                                                        | Use `@throws`, `@response`, `@requestBody`, `@tags`, `@deprecated` or `@remarks`.                                                               |
| `OA-E001` | warning                                           | An `errors` entry whose exception status cannot be read from its source. The entry is ignored.                                    | Name a class with a numeric `status` field or `static status`.                                                                                  |
| `OA-E002` | warning                                           | A package exception that renders its own body, which its declaration does not carry. It is documented without one.                | Render it in an `instanceof` branch of the exception handler's `handle()`.                                                                      |
| `OA-E003` | warning                                           | An `errors.throwers` or `errors.middleware` key that matches nothing in the documented routes.                                    | Fix the key. See [Errors config](#errors-config).                                                                                               |
| `OA-S001` | warning                                           | An operation without OpenAPI tags.                                                                                                | Add `@tags` to the action or its controller class.                                                                                              |
| `OA-S002` | warning                                           | An OpenAPI tag that `document.tags` does not declare.                                                                             | Declare it in `document.tags`.                                                                                                                  |
| `OA-S003` | warning                                           | A summary longer than `rules.summaryMaxLength`.                                                                                   | Shorten the first paragraph of the comment.                                                                                                     |
| `OA-S004` | warning                                           | A summary whose final period breaks `rules.summaryTrailingPeriod`.                                                                | Add or remove the period.                                                                                                                       |
| `OA-O001` | error                                             | An `operationId` that two operations share. It names the first one.                                                               | Return a different id from `operationId`, or rename the route.                                                                                  |
| `OA-J001` | warning                                           | A type with no JSON Schema, emitted as `{}`.                                                                                      | Return a plain data type.                                                                                                                       |
| `OA-J002` | warning                                           | A Lucid model returned directly, emitted as `{}`.                                                                                 | Return it through a transformer.                                                                                                                |

## Serve a docs page

`openapiRoutes()` registers two routes: a page that renders the document with [Scalar](https://github.com/scalar/scalar), and the document itself.

```ts
// start/routes.ts
import { middleware } from '#start/kernel'
import { openapiRoutes } from '@enzopita/adonisjs-openapi/routes'

openapiRoutes().use(middleware.auth({ guards: ['basic'] }))
```

| Route                    | Name               | Response                            |
| ------------------------ | ------------------ | ----------------------------------- |
| `GET /docs`              | `openapi.ui`       | The HTML page                       |
| `GET /docs/openapi.json` | `openapi.document` | The document, as `application/json` |

`openapiRoutes()` returns the route group, so `.use()`, `.domain()`, `.prefix()` and `.as()` work on it. `.as('admin')` names the routes `admin.openapi.ui` and `admin.openapi.document`.

The page loads the document from a URL relative to the page, so it keeps working behind a proxy that serves the app under a path prefix. The generator leaves both routes out of the document, as it does every closure route. Tuyau keeps named closure routes, so they appear in its client registry. To leave them out, exclude them where `adonisrc.ts` calls `generateRegistry()`:

```ts
generateRegistry({ routes: { except: [/^openapi\./] } })
```

### Turn the page on or off

The routes exist only where `openapiRoutes()` runs. To serve the page outside production only:

```ts
import app from '@adonisjs/core/services/app'

if (!app.inProduction) openapiRoutes()
```

To turn it on with an environment variable, declare `OPENAPI_DOCS: Env.schema.boolean.optional()` in `start/env.ts`, then:

```ts
import env from '#start/env'

if (env.get('OPENAPI_DOCS')) openapiRoutes().use(middleware.auth({ guards: ['basic'] }))
```

To remove the page, delete the call. No other file of the app imports `@enzopita/adonisjs-openapi/routes`.

### Options

| Option      | Default                                    | Description                                                                                                                                      |
| ----------- | ------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| `prefix`    | `'/docs'`                                  | Path of the page. The document is at `<prefix>/openapi.json`.                                                                                    |
| `ui`        | `'scalar'`                                 | `'scalar'`, `'swagger-ui'`, `'redoc'`, or a function that returns the page HTML.                                                                 |
| `uiOptions` | `{}`                                       | Passed as JSON to the UI's init call: `Scalar.createApiReference()`, `SwaggerUIBundle()` or Redoc's `init()`.                                    |
| `cdn`       | jsDelivr, see below                        | `{ script }` for Scalar and Redoc, `{ script, style }` for Swagger UI. Replaces the default URLs, for example to serve the files from `public/`. |
| `title`     | `document.info.title` from the config      | The page `<title>`.                                                                                                                              |
| `source`    | `'file'` in production, `'live'` otherwise | `'live'` generates the document on each request. `'file'` serves the file `node ace openapi:generate` wrote.                                     |
| `transform` | none                                       | `(document, ctx) => document`, applied to each response. It receives a copy, so it can edit the document in place.                               |

The default assets come from jsDelivr, pinned to a major version:

| UI           | Files                                                                           |
| ------------ | ------------------------------------------------------------------------------- |
| `scalar`     | `@scalar/api-reference@1/dist/browser/standalone.js`                            |
| `swagger-ui` | `swagger-ui-dist@5/swagger-ui-bundle.js` and `swagger-ui-dist@5/swagger-ui.css` |
| `redoc`      | `redoc@3/bundles/redoc.standalone.js`                                           |

A function `ui` receives `title`, `documentUrl` and `nonce`, and returns the whole page. `documentUrl` is relative to the page. `nonce` is set when Shield's CSP is enabled.

```ts
openapiRoutes({
  ui: ({ title, documentUrl }) => `<!doctype html>
<title>${title}</title>
<redoc spec-url="${documentUrl}"></redoc>
<script type="module" src="https://cdn.redoc.ly/redoc/v3.x/bundles/redoc.standalone.js"></script>`,
})
```

`transform` can fill in what the config cannot know, such as the host a request came to:

```ts
openapiRoutes({
  transform: (document, { request }) => ({
    ...document,
    servers: [{ url: `${request.protocol()}://${request.host()}` }],
  }),
})
```

### Where the document comes from

With `source: 'live'`, each request runs the generator in the app process. The page always matches the routes, with no command to run. The generator reads the TypeScript sources and needs `@adonisjs/assembler`, which the dev server and `node ace test` have.

With `source: 'file'`, the route serves the file `node ace openapi:generate` wrote at `output`. In production, the route reads the file once and keeps it in memory. Elsewhere, it reads the file on each request. When the file is missing, the route responds with a `500` error that names `node ace openapi:generate` and the build hook.

### Ship the document with the build

A `node ace build` output has no TypeScript sources, and a production install has no `@adonisjs/assembler`. In production, the page serves the file instead. `node ace add` registers the build hook that writes the file:

```ts
// adonisrc.ts
export default defineConfig({
  hooks: {
    buildStarting: [() => import('@enzopita/adonisjs-openapi/build_hook')],
  },
})
```

The hook runs `node ace openapi:generate --no-strict` before `node ace build` compiles the app, and adds `output` to the files the build copies, so the document lands in `build/` at the same path. A warning does not fail the build, even with `strict: true`: run `openapi:check --strict` in CI to fail on warnings. An error does fail it. An `output` outside the app root is not copied, and the hook prints a warning.

### Protect the page

A browser opens the page with a plain navigation. It sends cookies and HTTP basic credentials, but it has no way to add an `Authorization: Bearer` header. A guard that reads a bearer token, such as the access tokens guard, answers `401` to every visit from a browser. Use a guard that the browser can satisfy:

- The basic auth guard. On a `401`, the browser shows its own login prompt. Serve the page over HTTPS, because basic auth sends the password with every request.
- The session guard, if the app already has a login page.

The basic auth guard needs an entry in `config/auth.ts`:

```ts
import { basicAuthGuard, basicAuthUserProvider } from '@adonisjs/auth/basic_auth'

const authConfig = defineConfig({
  guards: {
    basic: basicAuthGuard({
      provider: basicAuthUserProvider({ model: () => import('#models/user') }),
    }),
  },
})
```

### Content Security Policy

Shield's CSP is off in a new app. If you turn it on, the page needs the directives below on top of `defaultSrc: ["'self'"]`. The page sets Shield's nonce on its scripts, so `@nonce` allows them. Each UI loads in Chromium with no CSP violation under these directives.

| UI           | Directives                                                                                                         |
| ------------ | ------------------------------------------------------------------------------------------------------------------ |
| `scalar`     | `scriptSrc: ['@nonce']`, `styleSrc: ["'unsafe-inline'"]`, `fontSrc: ['https://fonts.scalar.com']`                  |
| `swagger-ui` | `scriptSrc: ['@nonce']`, `styleSrc: ['https://cdn.jsdelivr.net']`, `imgSrc: ['data:']`                             |
| `redoc`      | `scriptSrc: ['@nonce']`, `styleSrc: ["'unsafe-inline'"]`, `fontSrc: ['data:']`, `imgSrc: ['https://cdn.redoc.ly']` |

Shield applies one policy to every route, so these directives apply to the whole app. A custom `cdn` replaces `https://cdn.jsdelivr.net` with the host it points to.

## Migrating from 0.x

1.0 gives each doc tag form one meaning and takes every body from a class. Most of the work is rewriting doc tags by hand, and the generator tells you which ones. Do the steps in order:

- Until step 1 is done, `defineConfig()` throws, so no ace command runs.
- From step 2 on, run `node ace openapi:generate` after each step and read its diagnostics. It writes no file while a diagnostic is an error: a numeric `@throws` until step 2, and a `@response {N} reason` whose status nothing derives until step 4.
- Until step 6 is done, each run also prints `OA-S001` for each operation without OpenAPI tags. To read the other diagnostics first, filter them out: `node ace openapi:generate 2>&1 | grep -v OA-S001`.

### 1. Group the config

`defineConfig()` throws on a 0.x key and names where it went:

| 0.x                  | 1.0                   |
| -------------------- | --------------------- |
| `info`               | `document.info`       |
| `servers`            | `document.servers`    |
| `tags`               | `document.tags`       |
| `securitySchemes`    | `security.schemes`    |
| `middlewareSecurity` | `security.middleware` |
| `errorResponse`      | `errors.body`         |

`openapi:generate --output` and the `file` option of `openapiRoutes()` are removed. Set `output` in the config instead. The build hook now copies `output` into the build, so the `openapi.json` entry that `node ace add` put in the `metaFiles` of `adonisrc.ts` is no longer needed. Leaving it is harmless.

### 2. Rewrite the `@throws` doc tags that fail generation

Generation stops on each of these with `OA-T001`, and the message names the file and line:

- Replace every `@throws {N} reason` with `@response {N} reason`, with the same reason.
- Split `@throws {A | B} reason` into one `@throws` per class.
- Add the braces to a `@throws` without them: `@throws {EmailTakenException}`.

Then generate. Each `@response {N} reason` whose status nothing derives yet gets `OA-T003`. The next two steps resolve them.

### 3. Name what packages throw

List the package calls your actions make that throw, and add each to `errors.throwers`. Add each package middleware that throws, such as a limiter throttle, to `errors.middleware`:

```ts
import { errors as authErrors } from '@adonisjs/auth'
import { errors as lucidErrors } from '@adonisjs/lucid'
import { errors as bouncerErrors } from '@adonisjs/bouncer'
import { errors as limiterErrors } from '@adonisjs/limiter'

errors: {
  throwers: {
    'bouncer.authorize': bouncerErrors.E_AUTHORIZATION_FAILURE,
    'findOrFail': lucidErrors.E_ROW_NOT_FOUND,
    'firstOrFail': lucidErrors.E_ROW_NOT_FOUND,
    'User.verifyCredentials': authErrors.E_INVALID_CREDENTIALS,
  },
  middleware: {
    // limiter.define('login_ip', ...) is the login_ipThrottle of node ace list:routes.
    login_ipThrottle: limiterErrors.E_TOO_MANY_REQUESTS,
  },
},
```

A key that matches no call gets `OA-E003`, so a misspelled key shows up at once.

### 4. Resolve the remaining `OA-T003`

A `@response {N} reason` still reported with `OA-T003` describes a status that nothing derives. Decide each one:

- The status comes from an exception class the action throws where the generator cannot see it: write `@throws {Class}`.
- No class exists, such as a `413` the bodyparser throws as a plain `Exception`: declare the body with `@response {413} {RequestEntityTooLarge}`, and declare that type in the controller.

You can also replace `@throws {import('#exceptions/x').default}` with the class name, unless two classes share the name (`OA-T002`).

To check that the `@response {N} reason` doc tags only describe, delete them all and generate again. The document keeps the same statuses and bodies, and only descriptions change.

### 5. Move repeated reasons to their class

A reason copied into many actions, such as the `400` of a tenant middleware, belongs to the middleware or exception class it comes from. Write it once as the first paragraph of the class's doc comment, and delete the copies. See [Describe a response once](#describe-a-response-once). Keep a reason on the action only when it says something specific to that action.

### 6. Tag every operation

An operation no longer gets an OpenAPI tag from its route name. Add `@tags` to each controller class, or to each action, and declare every OpenAPI tag in `document.tags`. `OA-S001` lists the operations without one, and `OA-S002` the undeclared ones.

### 7. Update the code that calls the generator

Skip this step if no code of yours imports from the package:

- `generateDocument()` returns `{ document, diagnostics, provenance }` instead of a list of warning strings. Each diagnostic has `code`, `severity`, `route`, `message`, `fix` and `location`, and keeps its own severity: `strict` only applies in the commands.
- `@enzopita/adonisjs-openapi/types` exports only public types. `RouteOperation` is gone. `GeneratedDocument` and `OpenApiUserConfig` are new, and `OpenApiOperation.tags` is optional.

### 8. Check what clients see

Regenerate the document and review its diff before you regenerate clients from it:

- A `.nullable()` field is now in `required`.
- A validator field named `query` is now a body field, not a set of query parameters.
- Each `findOrFail()` in an action or a function it calls adds a `404` through the thrower. See [Errors config](#errors-config).
- A response described on its class is a `$ref` to `components.responses`, and the class's doc comment is its description.

### 9. Keep the document checked

Commit `output`, then run `node ace openapi:check --strict` in CI and before each push. See [Run the check in CI and in a git hook](#run-the-check-in-ci-and-in-a-git-hook).

## Limitations

Known cases where the document differs from what the app sends, or where the generator needs a tag:

- A policy that denies with a status of its own, such as `AuthorizationResponse.deny('Not found', 404)`, sends that status at runtime. The generator documents the class's `403`. Declare the other with `@response {404} {Type}`.
- A package that throws a plain `Exception` with no exported class, such as the bodyparser's `413`, cannot be named in `errors`. Declare the response with `@response {N} {Type}`.
- `download()` and `attachment()` with a path built at runtime, such as `app.makePath('report.pdf')`, are documented as `application/octet-stream`. The app sends the media type of the file's extension.
- A thrower key matches every call of its method, so a `findOrFail()` that cannot fail still documents its `404`. See [Errors config](#errors-config).
- The paginator `metadata` fields are typed `string` by Lucid's `SimplePaginatorMetaKeys`, so they are documented as strings. The app sends numbers and `null`. Fix the type in the app's serializer.
