# @enzopita/adonisjs-openapi

Generate an OpenAPI 3.1 document from an AdonisJS 7 app, with no annotations. The generator reads the same sources as [Tuyau](https://github.com/Julien-R44/tuyau):

| OpenAPI                             | Source                                                                                         |
| ----------------------------------- | ---------------------------------------------------------------------------------------------- |
| Paths and operations                | Named routes from the router                                                                   |
| Request body, query and path params | The VineJS validator passed to `request.validateUsing()` (formats, bounds and enums included)  |
| Responses                           | The return type of the controller method, such as `serialize(UserTransformer.transform(user))` |
| Status codes                        | Response helpers such as `response.created()`, plus `@throws` tags in the doc comment          |
| `summary`, `description`, `tags`    | The doc comment on the controller method and its class                                         |
| Named schemas                       | The transformer types `node ace codegen` writes to `.adonisjs/client/data.d.ts`                |
| `422` response                      | Added to every route that validates its input                                                  |
| `401` response and `security`       | Named middleware on the route, mapped in the config                                            |

Controllers, validators and transformers import nothing from this package. Everything it reads is code an AdonisJS app already has, or a doc comment.

## Install

```sh
node ace add @enzopita/adonisjs-openapi
```

The command installs the package and creates `config/openapi.ts`. In `adonisrc.ts`, it registers the ace command and the build hook that writes the document during `node ace build`, and adds the document to `metaFiles`. The package needs `@adonisjs/assembler`, which every AdonisJS app has as a dev dependency.

## Generate the document

```sh
node ace openapi:generate
```

The command boots the app the way `node ace codegen` does, so no database connection or queue worker starts. It writes `openapi.json` at the app root. To write it somewhere else, pass `--output=public/openapi.json` or set `output` in the config. An absolute `--output` is used as given.

Each warning starts with a stable code, such as `OA-R002`, and names the route and the source line when it has one. `generateDocument()` returns them as `diagnostics`, with `code`, `severity`, `route`, `message`, `fix` and `location`.

To see where each response of a route comes from, pass the route name to `--explain`. The command prints the sources and writes no file:

```sh
node ace openapi:generate --explain=users.users.show
# 200
#   the handler's return type (app/controllers/users_controller.ts:32)
# 404
#   a @throws tag (app/controllers/users_controller.ts:30)
# 422
#   the validator rejects the input
```

### Check the committed document

```sh
node ace openapi:check
```

The command generates the document in memory and compares it with the file at `output`. When they differ, it lists the JSON Pointers that changed and exits with code `1`. Run it in CI when clients are generated from the committed file.

## Configure

```ts
// config/openapi.ts
import { defineConfig } from '@enzopita/adonisjs-openapi'

export default defineConfig({
  output: 'openapi.json',
  info: {
    title: 'Acme API',
    version: '1.0.0',
    license: { name: 'MIT', identifier: 'MIT' },
  },
  servers: [{ url: 'https://api.acme.test' }],
  tags: [{ name: 'Users', description: 'Public user profiles' }],
  routes: { except: ['admin.'] },
  securitySchemes: {
    accessToken: { type: 'http', scheme: 'bearer' },
  },
  middlewareSecurity: {
    auth: 'accessToken',
  },
})
```

- `routes` takes `only` or `except`, with the same matchers as Tuyau's `generateRegistry()`: a substring, a regular expression, or a function of the route name.
- `info` is the OpenAPI Info Object: `title` and `version`, and optionally `summary`, `description`, `termsOfService`, `contact` and `license`.
- `tags` is copied to the document's top-level `tags`. Use it to describe the tags operations use and to set their order.
- `middlewareSecurity` maps a named middleware, such as `middleware.auth()`, to a key of `securitySchemes`. Routes behind it get the scheme in `security` and a `401` response. A route behind several mapped middleware, such as `middleware.auth()` and `middleware.tenant()`, requires all their schemes together: they share one Security Requirement Object.
- `errorResponse` is the body of every error response without a documented one, as a type expression such as `"import('#types/api').ApiError"`. Without it, that body is read from the exception handler. See [Error bodies](#error-bodies).

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
| `title`     | `info.title` from the config               | The page `<title>`.                                                                                                                              |
| `source`    | `'file'` in production, `'live'` otherwise | `'live'` generates the document on each request. `'file'` serves the file `node ace openapi:generate` wrote.                                     |
| `file`      | `output` from the config                   | The file `source: 'file'` reads, relative to the app root.                                                                                       |
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

With `source: 'file'`, the route serves the file `node ace openapi:generate` wrote. In production, the route reads the file once and keeps it in memory. Elsewhere, it reads the file on each request. When the file is missing, the route responds with a `500` error that names `node ace openapi:generate` and the build hook.

### Ship the document with the build

A `node ace build` output has no TypeScript sources, and a production install has no `@adonisjs/assembler`. In production, the page serves the file instead. `node ace add` registers what writes the file and copies it into `build/`:

```ts
// adonisrc.ts
export default defineConfig({
  metaFiles: [{ pattern: 'openapi.json', reloadServer: false }],
  hooks: {
    buildStarting: [() => import('@enzopita/adonisjs-openapi/build_hook')],
  },
})
```

The hook runs `node ace openapi:generate` before `node ace build` compiles the app, and `metaFiles` copies `openapi.json` into `build/`. If you change `output` in the config, change the `metaFiles` pattern to match.

Without the hook, you can commit the generated file and keep it in `metaFiles`. Run `node ace openapi:generate` again each time the routes change.

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
   * @throws {404} User not found
   */
  async show({ request, serialize }: HttpContext) {
    const { params } = await request.validateUsing(showUserValidator)

    return serialize(UserTransformer.transform(await User.findOrFail(params.id)))
  }
}
```

- The first paragraph is the `summary`. The next paragraphs and `@remarks` are the `description`.
- `@deprecated` marks the operation as deprecated.
- `@tags Users, Admin` sets the operation tags. On the class, it applies to every method. A method's own `@tags` replaces the class tags. Without either, the tag is the first segment of the route name.
- `@throws {404} User not found` adds a `404` response with that description and the body of the [exception handler](#error-bodies). Without a description, the standard status text is used. When several tags document one status code, their descriptions are joined with `; `. A tag that can't be documented, such as a name not in scope or a class with no status code, is skipped with a warning from `openapi:generate`.
- `@throws {SmsRejectedException}` adds the response of an exception class. See [Exception responses](#exception-responses).
- `@throws {SmsRejectedException | InvalidAttachmentException}` adds the response of each class in the union, each under its own status code.
- `@throws {import('#exceptions/user_disabled_exception').default}` names a class without importing it, such as one an action or a service throws. It works for any export: `import('#exceptions/errors').E_LOCKED`.
- `@requestBody {TypeName}` sets the request body schema from a type in scope in the controller file, or from `{import('#types/webhooks').MailEvent}`. Use it when the handler reads the body without a validator, such as a webhook payload. It replaces the body the validator would document.

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

The class must be in scope in the controller file, usually through the import the handler throws it with, or named with `import('...')`. When several exceptions share a status code, or an exception uses `422` on a route that validates its input, the body schema is a `oneOf` of each distinct body and `ValidationError`.

A class from a package only documents a status its declaration types as a literal. `E_ROW_NOT_FOUND` from `@adonisjs/lucid/errors` declares `status: number`, so document the `404` of `findOrFail()` with `@throws {404}`.

## Error bodies

An error status with no body of its own, such as `@throws {404}`, the `401` of a secured route or an exception without `handle()`, gets the body the app's exception handler sends. The generator reads the handler `start/kernel.ts` registers with `server.errorHandler()`, or `#exceptions/handler`:

```ts
export default class HttpExceptionHandler extends ExceptionHandler {
  override async renderErrorAsJSON(error: Exception, ctx: HttpContext) {
    ctx.response
      .status(error.status)
      .send({ code: error.code ?? 'E_UNKNOWN', message: error.message })
  }
}
```

- What `handle()` and `renderErrorAsJSON()` send, with the functions of the app they call, is the body of every such status. It becomes the `Error` schema in `components.schemas`.
- A response helper with a body, such as `ctx.response.tooManyRequests(body)` for `E_TOO_MANY_REQUESTS`, is the body of that status only.
- A handler that overrides neither sends the framework's `{ message: string }`.
- The `401` of a secured route gets the `{ errors: [{ message }] }` that `E_UNAUTHORIZED_ACCESS` from `@adonisjs/auth` renders for a client that accepts JSON, unless the handler answers `401` with a helper of its own.
- `errorResponse` in the config replaces all of the above.

## Middleware responses

A middleware that ends the request documents its response on every route it runs on: the named middleware a route uses and the ones `router.use()` and `server.use()` register in `start/kernel.ts`. Its `handle()` is read like an exception's, so `response.forbidden(body)` or `response.status(403).send(body)` adds a `403` with that body. An exception it throws, such as `throw new TwoFactorRequiredException()`, adds the response of that class, and `response.abort()` and `response.redirect()` add theirs. Middleware from packages are not read.

```ts
export default class TenantMiddleware {
  async handle(ctx: HttpContext, next: NextFn) {
    if (!ctx.request.header('x-tenant-id')) {
      return ctx.response.badRequest({
        code: 'E_INVALID_TENANT_HEADER' as const,
        message: 'Missing tenant',
      })
    }

    return next()
  }
}
```

## Status codes

A response comes from each status code the handler can answer with. Branches that share a status code are merged, with a `oneOf` of their bodies:

- `return serialize(...)` or a plain object is a `200`, or the status of a `response.status(201)` called before it. `return response.json(body)` works the same way.
- `return response.created(await serialize(...))` is a `201` with the serialized body. Every `HttpResponse` helper that sets a 2xx, 4xx or 5xx status works this way, such as `noContent()`, `accepted()` or `notFound(body)`. This uses the same types Tuyau adds to `HttpResponse`, and works without Tuyau too.
- A helper or `response.send(body)` called without `return` counts too, since the handler's own response calls are read along with its return type.
- `return null` is a `204` with no body. When the return type also includes `undefined`, the description says the response can have no body.
- `response.redirect(...)` is a `302`, or the status passed to it, with a `Location` header.
- `response.abort(body, 403)`, `abortIf()` and `abortUnless()` add their status with that body, or `400` without a status.
- `204`, `205` and `304` responses, and helpers called without a body, have no `content`.
- A `@throws` tag adds its status code, and its description replaces the standard status text.
- Routes that validate their input get a `422`. Routes behind a middleware mapped in `middlewareSecurity` get a `401`.
- A middleware of the route that answers with a status adds it. See [Middleware responses](#middleware-responses).
- A handler with no typed answer gets a `200` with no schema and a warning. A handler that only answers with errors, such as `return response.tooManyRequests(body)`, gets no `200`.

## Media types and headers

- A returned string is sent as `text/plain`. A literal `response.header('content-type', 'text/csv')` in the handler replaces the media type of its bodies.
- `response.download()`, `attachment()` and `stream()` are documented as `application/octet-stream` with `format: binary`. `attachment()` adds a `Content-Disposition` header.
- A header the handler sets with a literal name, such as `response.header('Retry-After', '10')`, is documented on every response the handler sends, but not on the response of an exception it throws.

## Named schemas

When `.adonisjs/client/data.d.ts` exists, every type in its `Data` namespace becomes a schema in `components.schemas`, named by its path below `Data`: `User`, or `Admin.User` for a nested namespace. Responses reference them with `$ref`, including items of a collection and transformers nested in an object passed to `serialize()`. The `422` body is the `ValidationError` schema.

`node ace codegen` writes that file when `indexEntities()` in `adonisrc.ts` has transformers enabled. Without it, schemas are inlined.

## How types become schemas

- A route must have a name and a controller handler. Closure routes are skipped with a warning, except the ones `openapiRoutes()` registers.
- On `GET` operations, the validator fields become query parameters. On other methods they become the body, and the validator's `query` and `params` objects become query and path parameters. A route that answers `GET` and `POST` gets one of each.
- An object query parameter uses `style: deepObject`, as the app reads `filter[status]=x`.
- An optional path parameter, `/users/:id?`, documents both `/users` and `/users/{id}`. The shorter path's `operationId` ends with `.without_id`.
- A `HEAD`-only route is left out.
- A body with a `vine.file()` field is sent as `multipart/form-data`.
- When VineJS cannot describe a field (a file, a custom rule), the generator uses the field's TypeScript type.
- `Date` and Luxon `DateTime` values become `{ type: 'string', format: 'date-time' }`.
- `Map` and `Set` become an empty object and `bigint` a string, as they serialize. Symbol keys and properties typed `undefined` are left out.
- A Lucid model returned directly becomes `{}` with a warning, because its type does not describe what `serialize()` sends. Return it through a transformer.

## Limitations

Known cases where the document differs from what the app sends. They are tracked in [#19](https://github.com/enzopita/adonisjs-packages/issues/19); until fixed, document them with `@throws` or avoid the pattern.

- A bouncer `authorize()` `403` is not documented: the exception is thrown inside `@adonisjs/bouncer`, and functions from packages are not followed. Use `@throws {403}`.
- `download()` and `attachment()` are documented as `application/octet-stream`; the app sends the media type of the file's extension.
- The paginator `metadata` fields are typed `string` by Lucid's `SimplePaginatorMetaKeys`, so they are documented as strings; the app sends numbers and `null`.
- An array in a `GET` validator rejects a single value (`?tags=a`) with a `422`; send the key twice.
