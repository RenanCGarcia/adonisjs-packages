# @enzopita/adonisjs-openapi

Generate an OpenAPI 3.1 document from an AdonisJS 7 app, with no annotations. The generator reads the same sources as [Tuyau](https://github.com/Julien-R44/tuyau):

| OpenAPI                             | Source                                                                                         |
| ----------------------------------- | ---------------------------------------------------------------------------------------------- |
| Paths and operations                | Named routes from the router                                                                   |
| Request body, query and path params | The VineJS validator passed to `request.validateUsing()` (formats, bounds and enums included)  |
| Responses                           | The return type of the controller method, such as `serialize(UserTransformer.transform(user))` |
| `422` response                      | Added to every route that validates its input                                                  |
| `security`                          | Named middleware on the route, mapped in the config                                            |

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
  info: { title: 'Acme API', version: '1.0.0' },
  servers: [{ url: 'https://api.acme.test' }],
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
- `middlewareSecurity` maps a named middleware, such as `middleware.auth()`, to a key of `securitySchemes`.

## How types become schemas

- A route must have a name and a controller handler. Closure routes are skipped, as they are in Tuyau.
- On `GET` routes, the validator fields become query parameters. On other methods they become the body, and the validator's `query` and `params` objects become query and path parameters.
- A body with a `vine.file()` field is sent as `multipart/form-data`.
- When VineJS cannot describe a field (a file, a custom rule), the generator uses the field's TypeScript type.
- `Date` and Luxon `DateTime` values become `{ type: 'string', format: 'date-time' }`.
- A handler that returns a model or an untyped object produces a `200` response with no schema and a warning. Return `serialize(...)` to type it.

## Limitations

- Schemas are inlined. Transformers do not become named components yet.
- Operations have no `summary` or `description` yet.
- Status codes other than `200` and `422` come only from return types that carry a `__status`, which no AdonisJS 7.6 API produces yet.
