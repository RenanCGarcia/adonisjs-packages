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
}

export type HttpMethod = 'get' | 'post' | 'put' | 'patch' | 'delete' | 'options'

/**
 * One named route as the generator sees it: where it lives, and the TypeScript
 * expressions the routes scanner extracted for its input and output.
 */
export interface RouteOperation {
  name: string
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
}

export interface OpenApiResponse {
  description: string
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
