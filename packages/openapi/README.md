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

Nothing in the app imports from this package. Everything it reads is code an AdonisJS app already has, or a doc comment.

## Install

```sh
node ace add @enzopita/adonisjs-openapi
```

The command installs the package, registers its ace command in `adonisrc.ts`, and creates `config/openapi.ts`. The package needs `@adonisjs/assembler`, which every AdonisJS app has as a dev dependency.

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
- `middlewareSecurity` maps a named middleware, such as `middleware.auth()`, to a key of `securitySchemes`. Routes behind it get the scheme in `security` and a `401` response.

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
- `@throws {404} User not found` adds a `404` response with that description. Without a description, the standard status text is used. Tags whose type is not a three-digit code are ignored.

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

- A route must have a name and a controller handler. Closure routes are skipped, as they are in Tuyau.
- On `GET` routes, the validator fields become query parameters. On other methods they become the body, and the validator's `query` and `params` objects become query and path parameters.
- A body with a `vine.file()` field is sent as `multipart/form-data`.
- When VineJS cannot describe a field (a file, a custom rule), the generator uses the field's TypeScript type.
- `Date` and Luxon `DateTime` values become `{ type: 'string', format: 'date-time' }`.
- A handler that returns a model or an untyped object produces a `200` response with no schema and a warning. Return `serialize(...)` to type it.

## Limitations

- A status code set with `response.status(201)` is not detected, because the return type does not carry it. Return a helper such as `response.created(body)` instead.
- A thrown exception has no return type either. Add a `@throws` tag for each status code it can produce, such as the `404` of `findOrFail()`.
- A nested transformer is matched to its named schema by shape. Two transformers with the same output share the first schema name.
- Every type in `Data` is written to `components.schemas`, even if no route returns it.
