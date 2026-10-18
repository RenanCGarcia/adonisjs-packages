import type { OpenApiConfig } from './types.ts'

export function defineConfig(config: Partial<OpenApiConfig> = {}): OpenApiConfig {
  if (config.routes?.only && config.routes.except) {
    throw new Error('openapi: use either "routes.only" or "routes.except", not both')
  }

  return {
    output: 'openapi.json',
    info: { title: 'API', version: '1.0.0' },
    servers: [],
    tags: [],
    routes: {},
    securitySchemes: {},
    middlewareSecurity: {},
    ...config,
  }
}
