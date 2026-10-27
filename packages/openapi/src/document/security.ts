import type { SecurityConfig } from '../types.ts'
import type { RouteOperation } from '../routes/route_operation.ts'

/**
 * The middleware of a route that map to a scheme, and the `security` they give the operation.
 * Entries of `security` are alternatives, so the schemes a route requires together share one entry.
 */
export function securityFor(route: RouteOperation, middleware: SecurityConfig['middleware']) {
  const secured = route.middleware.filter(name => middleware[name])
  const schemes = secured.map(name => middleware[name]!)

  const security: Record<string, string[]>[] = schemes.length
    ? [Object.fromEntries(schemes.map(scheme => [scheme, []]))]
    : []

  return { secured, security }
}
