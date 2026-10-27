import type { HttpContext } from '@adonisjs/core/http'

export type JsonValue = string | number | boolean | null

/**
 * The JSON Schema keywords the generator reads or writes. Keywords Vine adds
 * (`minLength`, `pattern`...) pass through untouched.
 */
export interface JsonSchema {
  $ref?: string
  type?: string | string[]
  format?: string
  const?: JsonValue
  enum?: JsonValue[]
  properties?: Record<string, JsonSchema>
  required?: string[]
  additionalProperties?: boolean | JsonSchema
  items?: JsonSchema
  prefixItems?: JsonSchema[]
  minItems?: number
  maxItems?: number
  anyOf?: JsonSchema[]
  oneOf?: JsonSchema[]
  not?: JsonSchema
}

export type RouteMatcher = string | RegExp | ((routeName: string) => boolean)

export type SecurityScheme =
  | { type: 'http'; scheme: 'bearer' | 'basic'; bearerFormat?: string; description?: string }
  | { type: 'apiKey'; name: string; in: 'header' | 'query' | 'cookie'; description?: string }

export interface OpenApiConfig {
  /**
   * Where the document is written, relative to the app root.
   */
  output: string
  info: {
    title: string
    version: string
    summary?: string
    description?: string
    termsOfService?: string
    contact?: { name?: string; url?: string; email?: string }
    license?: { name: string; url?: string; identifier?: string }
  }
  servers: { url: string; description?: string }[]
  /**
   * Written as the document's top-level `tags`, to describe and order the tags operations use.
   */
  tags: { name: string; description?: string }[]
  /**
   * Same filters as Tuyau's `generateRegistry({ routes })`. Only one of them can be set.
   */
  routes: { only?: RouteMatcher[]; except?: RouteMatcher[] }
  securitySchemes: Record<string, SecurityScheme>
  /**
   * Maps a named middleware (as in `middleware.auth()`) to a key of `securitySchemes`.
   */
  middlewareSecurity: Record<string, string>
  errors: ErrorsConfig
}

/**
 * An exception class, or a constant holding one such as the `E_ROW_NOT_FOUND` of `@adonisjs/lucid`.
 */
export interface ExceptionClass {
  new (...args: never[]): Error & { status?: number }
  status?: number
}

export interface ErrorsConfig {
  /**
   * The body of an error the exception handler renders with no branch of its own, as a type
   * expression such as `import('#types/api').ApiError`. Defaults to what the handler sends.
   */
  body?: string
  /**
   * The exception a call throws inside a package, by the method that throws it: `findOrFail`
   * matches any call of that method, `bouncer.authorize` a call on `bouncer`, also through
   * `bouncer.with(Policy)`.
   */
  throwers?: Record<string, ExceptionClass>
  /**
   * The exception a middleware throws inside a package, by its name as `node ace list:routes`
   * shows it, such as `auth` or the `globalThrottle` of `limiter.define('global')`, or by its
   * kernel specifier.
   */
  middleware?: Record<string, ExceptionClass>
}

export type HttpMethod = 'get' | 'post' | 'put' | 'patch' | 'delete' | 'options'

/**
 * One named route as the generator sees it: where it lives, and the TypeScript
 * expressions the routes scanner extracted for its input and output.
 */
export interface RouteOperation {
  name: string
  /**
   * The route name, with a suffix on the path without an optional param, such as `users.show.without_id`.
   */
  operationId: string
  methods: HttpMethod[]
  path: string
  pathParams: string[]
  middleware: string[]
  requestType?: string
  responseType?: string
  imports: string[]
  validator?: { specifier: string; exportName: string }
  controller?: { path: string; method: string }
}

export interface OpenApiParameter {
  name: string
  in: 'path' | 'query'
  required: boolean
  schema: JsonSchema
  style?: 'deepObject'
  explode?: true
}

export interface OpenApiResponse {
  description: string
  headers?: Record<string, { schema: JsonSchema }>
  content?: Record<string, { schema: JsonSchema }>
}

export interface OpenApiOperation {
  operationId: string
  summary?: string
  description?: string
  tags: string[]
  deprecated?: true
  parameters?: OpenApiParameter[]
  requestBody?: { required: true; content: Record<string, { schema: JsonSchema }> }
  responses: Record<string, OpenApiResponse>
  security?: Record<string, string[]>[]
}

export interface OpenApiDocument {
  openapi: '3.1.0'
  info: OpenApiConfig['info']
  servers?: OpenApiConfig['servers']
  tags?: OpenApiConfig['tags']
  paths: Record<string, Partial<Record<HttpMethod, OpenApiOperation>>>
  components: {
    schemas: Record<string, JsonSchema>
    securitySchemes: OpenApiConfig['securitySchemes']
  }
}

/**
 * A line of the app's sources, relative to the app root. Lines start at 1.
 */
export interface SourceLocation {
  file: string
  line: number
}

/**
 * What documented a status code of an operation.
 */
export type ResponseSource = (
  | { kind: 'return' }
  | { kind: 'answer' }
  | { kind: 'throw'; exception: string }
  | { kind: 'thrower'; call: string; exception: string }
  | { kind: 'middleware'; middleware: string }
  | { kind: 'security'; middleware: string }
  | { kind: 'validator' }
  | { kind: 'tag'; tag: '@throws' | '@response' }
) & { location?: SourceLocation }

/**
 * Codes are stable: a code keeps its meaning across releases.
 *
 * - `OA-R001`: a closure route, skipped.
 * - `OA-R002`: a handler whose return type is unknown.
 * - `OA-V001`: a validator whose JSON Schema cannot be read.
 * - `OA-T001`: a `@throws` that names a status code or a union instead of one class, or a class without braces.
 * - `OA-T002`: a `@throws` class name that no exception class of the app has, or several have.
 * - `OA-T003`: a `@response {N} reason` whose status nothing documents.
 * - `OA-T004`: a `@response` status that is not a status code.
 * - `OA-T005`: a `@throws` type that does not resolve to a class.
 * - `OA-T006`: an exception with no status code.
 * - `OA-T007`: a `@requestBody` or `@response` type that does not resolve, an error for `@response`.
 * - `OA-T008`: a tag the generator does not read.
 * - `OA-E001`: an `errors` entry whose exception status cannot be read from its source.
 * - `OA-E002`: a package exception that renders its own body, which its declaration does not carry.
 * - `OA-E003`: an `errors.throwers` or `errors.middleware` key that matches nothing in the documented routes.
 * - `OA-J001`: a type with no JSON Schema, emitted as `{}`.
 * - `OA-J002`: a Lucid model, emitted as `{}`.
 */
export type DiagnosticCode =
  | 'OA-R001'
  | 'OA-R002'
  | 'OA-V001'
  | 'OA-T001'
  | 'OA-T002'
  | 'OA-T003'
  | 'OA-T004'
  | 'OA-T005'
  | 'OA-T006'
  | 'OA-T007'
  | 'OA-T008'
  | 'OA-E001'
  | 'OA-E002'
  | 'OA-E003'
  | 'OA-J001'
  | 'OA-J002'

export interface Diagnostic {
  code: DiagnosticCode
  severity: 'error' | 'warning'
  /**
   * The route name, absent for a problem of the whole document.
   */
  route?: string
  message: string
  fix?: string
  location?: SourceLocation
}

/**
 * What a docs UI needs to render its page.
 */
export interface DocsPage {
  title: string
  /**
   * Relative to the page, so the page keeps working behind a proxy that adds a path prefix.
   */
  documentUrl: string
  /**
   * The CSP nonce Shield sets on the response, when CSP is enabled.
   */
  nonce?: string
}

export type Json = JsonValue | Json[] | { [key: string]: Json }

/**
 * Serialized as JSON into the UI's own init call.
 */
export type UiOptions = { [key: string]: Json }

export type DocsUi =
  | { ui?: 'scalar'; uiOptions?: UiOptions; cdn?: { script?: string } }
  | { ui: 'swagger-ui'; uiOptions?: UiOptions; cdn?: { script?: string; style?: string } }
  | { ui: 'redoc'; uiOptions?: UiOptions; cdn?: { script?: string } }
  | { ui: (page: DocsPage) => string; uiOptions?: never; cdn?: never }

export type DocsOptions = DocsUi & {
  /**
   * Path of the page. The document is served at `<prefix>/openapi.json`.
   */
  prefix?: string
  title?: string
  /**
   * `live` generates the document on each request and needs the app's TypeScript
   * sources. `file` serves the file `node ace openapi:generate` wrote.
   */
  source?: 'live' | 'file'
  /**
   * The file `source: 'file'` reads, relative to the app root. Defaults to the config `output`.
   */
  file?: string
  transform?: (
    document: OpenApiDocument,
    ctx: HttpContext,
  ) => OpenApiDocument | Promise<OpenApiDocument>
}
