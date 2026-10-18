import { RoutesScanner } from '@adonisjs/assembler/routes_scanner'
import type { RoutesListItem } from '@adonisjs/assembler/types'
import type { Router } from '@adonisjs/core/http'
import type { HttpMethod, OpenApiConfig, RouteMatcher, RouteOperation } from './types.ts'

const METHODS = new Set<string>(['get', 'post', 'put', 'patch', 'delete', 'options'])

function matches(routeName: string, matcher: RouteMatcher) {
  if (matcher instanceof RegExp) return matcher.test(routeName)

  if (matcher instanceof Function) return matcher(routeName)

  return routeName.includes(matcher)
}

function isIncluded(routeName: string, filters: OpenApiConfig['routes']) {
  if (filters.only) return filters.only.some(matcher => matches(routeName, matcher))

  if (filters.except) return !filters.except.some(matcher => matches(routeName, matcher))

  return true
}

/**
 * `/users/:id/:slug?` becomes `/users/{id}/{slug}`, the only form OpenAPI paths accept.
 */
function toOpenApiPath(pattern: string) {
  return pattern.replace(/:([^/?]+)\??/g, '{$1}').replace(/\*/g, '{wildcard}')
}

/**
 * Scans the committed router with the same routes scanner the dev server feeds
 * Tuyau, so both see the same request and response types.
 */
export async function collectRoutes(
  appRoot: string,
  router: Router,
  config: OpenApiConfig,
): Promise<RouteOperation[]> {
  const live = router.toJSON()
  const middlewareByRoute = new Map<string, string[]>()

  for (const route of Object.values(live).flat()) {
    const names = [...route.middleware.all()].flatMap(entry =>
      'name' in entry && entry.name ? [entry.name] : [],
    )

    middlewareByRoute.set(`${route.domain}:${route.pattern}:${route.methods.join(',')}`, names)
  }

  // Round-tripped through JSON like the dev server and `node ace codegen` do, which drops closure handlers.
  const serialized: Record<string, RoutesListItem[]> = JSON.parse(JSON.stringify(live))
  const scanner = new RoutesScanner(appRoot, [])
  scanner.filter(route => isIncluded(route.name ?? '', config.routes))

  for (const routes of Object.values(serialized)) await scanner.scan(routes)

  return scanner.getScannedRoutes().map(route => {
    const pattern = toOpenApiPath(route.pattern)
    const [validator] = route.validators ?? []

    return {
      name: route.name,
      methods: route.methods
        .map(method => method.toLowerCase())
        .filter((method): method is HttpMethod => METHODS.has(method)),
      path: pattern,
      pathParams: [...pattern.matchAll(/\{([^}]+)\}/g)].map(match => match[1]!),
      middleware:
        middlewareByRoute.get(`${route.domain}:${route.pattern}:${route.methods.join(',')}`) ?? [],
      requestType: route.request?.type,
      responseType: route.response?.type,
      imports: [...(route.request?.imports ?? []), ...(route.response?.imports ?? [])],
      validator: validator && {
        specifier: validator.import.specifier,
        exportName: validator.import.value,
      },
      controller: route.controller && {
        path: route.controller.path,
        method: route.controller.method,
      },
    }
  })
}
