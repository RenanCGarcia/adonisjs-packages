import type { ErrorsConfig, OpenApiConfig, OpenApiUserConfig } from './types.ts'

// Where each 0.x key went, so a config that still sets one fails with the fix.
const MOVED = {
  info: 'document.info',
  servers: 'document.servers',
  tags: 'document.tags',
  securitySchemes: 'security.schemes',
  middlewareSecurity: 'security.middleware',
  errorResponse: 'errors.body',
} satisfies Record<string, string>

/**
 * Generic over `errors` so the type of the config keeps each exception the entries name: the
 * generator reads it to match the `instanceof` branches of the exception handler.
 */
export function defineConfig<const Errors extends ErrorsConfig = {}>(
  config: OpenApiUserConfig<Errors> = {},
): OpenApiConfig & { errors: Errors } {
  if (config.routes?.only && config.routes.except) {
    throw new Error('openapi: use either "routes.only" or "routes.except", not both')
  }

  // A JavaScript config, or one typed loosely, would otherwise lose the option without a sign.
  const moved = Object.entries(MOVED).filter(([key]) => key in config)

  if (moved.length) {
    const fixes = moved.map(([key, path]) => `"${key}" is now "${path}"`).join(', ')

    throw new Error(`openapi: the config groups its keys since 1.0: ${fixes}`)
  }

  const { document, security, ...rest } = config

  return {
    output: 'openapi.json',
    routes: {},
    strict: false,
    rules: {},
    // SAFETY: `Errors` defaults to `{}`, the only value a config without `errors` can have.
    errors: {} as Errors,
    ...rest,
    document: { info: { title: 'API', version: '1.0.0' }, servers: [], tags: [], ...document },
    security: { schemes: {}, middleware: {}, ...security },
  }
}
