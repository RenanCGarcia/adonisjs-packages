import type { OpenApiConfig, RouteOperation } from '../types.ts'

/**
 * The middleware of a route that map to a scheme, and the `security` they give the operation.
 * Entries of `security` are alternatives, so the schemes a route requires together share one entry.
 */
export function securityFor(
  route: RouteOperation,
  middlewareSecurity: OpenApiConfig['middlewareSecurity'],
) {
  const secured = route.middleware.filter(name => middlewareSecurity[name])
  const schemes = secured.map(name => middlewareSecurity[name]!)

  const security: Record<string, string[]>[] = schemes.length
    ? [Object.fromEntries(schemes.map(scheme => [scheme, []]))]
    : []

  return { secured, security }
}
