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

The command boots the app the way `node ace codegen` does, so no database connection or queue worker starts. It writes `openapi.json` at the app root. To write it somewhere else, pass `--output=public/openapi.json` or set `output` in the config.

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
- `@throws {404} User not found` adds a `404` response with that description. Without a description, the standard status text is used. A tag that can't be documented, such as a name not in scope or a class with no status code, is skipped with a warning from `openapi:generate`.
- `@throws {SmsRejectedException}` adds the response of an exception class. See [Exception responses](#exception-responses).
- `@throws {SmsRejectedException | InvalidAttachmentException}` adds the response of each class in the union, each under its own status code.
- `@requestBody {TypeName}` sets the request body schema from a type in scope in the controller file. Use it when the handler reads the body without a validator, such as a webhook payload. It replaces the body the validator would document.

## Exception responses

An exception class named by `@throws` documents its status code and its body:

- A response helper that `handle()` calls, such as `response.conflict(body)` or `response.unprocessableEntity(body)`, adds its status code and body.
- A `response.send(...)` or `response.json(...)` call adds a response with the status code of `static status`, on the class or a parent class: a number such as `422`, `422 as const`, a constant or an enum member. Without one, the code passed to `response.status(...)` is used. The body is the return type of an instance method named `toResponse()` or, without it, the type of what each call sends.
- A class whose `handle()` sends nothing still adds the response of its `static status`, with `toResponse()` as the body when it has one.

`handle()` is read with the functions of the app it calls, such as a shared `renderError(ctx, error)`. Functions from packages are not followed, and only calls on an `HttpResponse` count.

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

The class must be in scope in the controller file, usually through the import the handler throws it with. When several exceptions share a status code, or an exception uses `422` on a route that validates its input, the body schema is a `oneOf` of each body and `ValidationError`.

## Status codes

A response comes from each status code the handler can return:

- `return serialize(...)` or a plain object is a `200`.
- `return response.created(await serialize(...))` is a `201` with the serialized body. Every `HttpResponse` helper that sets a 2xx, 4xx or 5xx status works this way, such as `noContent()`, `accepted()` or `notFound(body)`. This uses the same types Tuyau adds to `HttpResponse`, and works without Tuyau too.
- `204`, `205` and `304` responses, and helpers called without a body, have no `content`.
- A `@throws` tag adds its status code when the return type has not.
- Routes that validate their input get a `422`. Routes behind a middleware mapped in `middlewareSecurity` get a `401`.

## Named schemas

When `.adonisjs/client/data.d.ts` exists, every type in its `Data` namespace becomes a schema in `components.schemas`, named by its path below `Data`: `User`, or `Admin.User` for a nested namespace. Responses reference them with `$ref`, including items of a collection and transformers nested in an object passed to `serialize()`. The `422` body is the `ValidationError` schema.

`node ace codegen` writes that file when `indexEntities()` in `adonisrc.ts` has transformers enabled. Without it, schemas are inlined.

## How types become schemas

- A route must have a name and a controller handler. Closure routes are skipped.
- On `GET` routes, the validator fields become query parameters. On other methods they become the body, and the validator's `query` and `params` objects become query and path parameters.
- A body with a `vine.file()` field is sent as `multipart/form-data`.
- When VineJS cannot describe a field (a file, a custom rule), the generator uses the field's TypeScript type.
- `Date` and Luxon `DateTime` values become `{ type: 'string', format: 'date-time' }`.
- A handler that returns a model or an untyped object produces a `200` response with no schema and a warning. Return `serialize(...)` to type it.

## Limitations

- A status code set with `response.status(201)` is not detected, because the return type does not carry it. Return a helper such as `response.created(body)` instead.
- A thrown exception has no return type either. Add a `@throws` tag for each status code it can produce, such as the `404` of `findOrFail()`, or for each exception class it throws.
- A nested transformer is matched to its named schema by shape. Two transformers with the same output share the first schema name.
- Every type in `Data` is written to `components.schemas`, even if no route returns it.
