export type RouteMatcher = string | RegExp | ((routeName: string) => boolean)

export type SecurityScheme =
  | { type: 'http'; scheme: 'bearer' | 'basic'; bearerFormat?: string; description?: string }
  | { type: 'apiKey'; name: string; in: 'header' | 'query' | 'cookie'; description?: string }

export interface DocumentInfo {
  title: string
  version: string
  summary?: string
  description?: string
  termsOfService?: string
  contact?: { name?: string; url?: string; email?: string }
  license?: { name: string; url?: string; identifier?: string }
}

export interface DocumentConfig {
  info: DocumentInfo
  servers: { url: string; description?: string }[]
  /**
   * Written as the document's top-level `tags`, to describe and order the tags operations use.
   */
  tags: { name: string; description?: string }[]
}

export interface SecurityConfig {
  schemes: Record<string, SecurityScheme>
  /**
   * Maps a named middleware (as in `middleware.auth()`) to a key of `schemes`.
   */
  middleware: Record<string, string>
}

export interface OpenApiConfig {
  /**
   * Where the document is written, relative to the app root.
   */
  output: string
  document: DocumentConfig
  /**
   * Same filters as Tuyau's `generateRegistry({ routes })`. Only one of them can be set.
   */
  routes: { only?: RouteMatcher[]; except?: RouteMatcher[] }
  security: SecurityConfig
  errors: ErrorsConfig
  /**
   * Makes every warning an error, so `openapi:generate` and `openapi:check` fail on it. The
   * `--strict` and `--no-strict` flags of both commands override it.
   */
  strict: boolean
  rules: RulesConfig
  /**
   * Replaces the `operationId` of every operation. Called once per method of each documented path
   * (`name` is the route name, `path` the OpenAPI path), and must return a unique id.
   */
  operationId?: (route: { name: string; method: string; path: string }) => string
}

/**
 * Style rules each operation is checked against. A rule left out is not checked.
 */
export interface RulesConfig {
  /**
   * The longest summary, in characters, without a warning.
   */
  summaryMaxLength?: number
  /**
   * `true` warns about a summary that does not end with a period, `false` about one that does.
   */
  summaryTrailingPeriod?: boolean
}

/**
 * What `defineConfig()` takes: every key is optional, and `document` and `security` merge their
 * keys over the defaults.
 */
export type OpenApiUserConfig<Errors extends ErrorsConfig = ErrorsConfig> = Partial<
  Omit<OpenApiConfig, 'document' | 'security' | 'errors'>
> & {
  document?: Partial<DocumentConfig>
  security?: Partial<SecurityConfig>
  errors?: Errors
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
