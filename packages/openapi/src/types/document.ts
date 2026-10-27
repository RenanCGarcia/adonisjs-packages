import type { DocumentConfig, DocumentInfo, SecurityConfig } from './config.ts'
import type { JsonSchema } from './json.ts'

export type HttpMethod = 'get' | 'post' | 'put' | 'patch' | 'delete' | 'options'

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

export interface OpenApiReference {
  $ref: string
}

export interface OpenApiOperation {
  operationId: string
  summary?: string
  description?: string
  tags?: string[]
  deprecated?: true
  parameters?: OpenApiParameter[]
  requestBody?: { required: true; content: Record<string, { schema: JsonSchema }> }
  responses: Record<string, OpenApiResponse | OpenApiReference>
  security?: Record<string, string[]>[]
}

export interface OpenApiDocument {
  openapi: '3.1.0'
  info: DocumentInfo
  servers?: DocumentConfig['servers']
  tags?: DocumentConfig['tags']
  paths: Record<string, Partial<Record<HttpMethod, OpenApiOperation>>>
  components: {
    schemas: Record<string, JsonSchema>
    responses?: Record<string, OpenApiResponse>
    securitySchemes: SecurityConfig['schemes']
  }
}
