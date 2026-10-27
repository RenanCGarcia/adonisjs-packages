import { RoutesScanner } from '@adonisjs/assembler/routes_scanner'
import type { RoutesListItem } from '@adonisjs/assembler/types'
import type { Router } from '@adonisjs/core/http'
import { closureRoute } from '../diagnostics/route.ts'
import type { Diagnostic, HttpMethod, OpenApiConfig, RouteMatcher } from '../types.ts'
import type { RouteOperation } from './route_operation.ts'

const METHODS = new Set<string>(['get', 'post', 'put', 'patch', 'delete', 'options'])

// The closures `openapiRoutes()` registers, which are left out on purpose.
const DOCS_ROUTES = new Set(['openapi.ui', 'openapi.document'])

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

function routeKey(route: { domain: string; pattern: string; methods: string[] }) {
  return `${route.domain}:${route.pattern}:${route.methods.join(',')}`
}

/**
 * `/users/:id/:slug?` becomes `/users/{id}/{slug}`, the only form OpenAPI paths accept.
 */
function toOpenApiPath(pattern: string) {
  return pattern.replace(/:([^/?]+)\??/g, '{$1}').replace(/\*/g, '{wildcard}')
}

/**
 * `/users/:id?` also matches `/users`, which OpenAPI only describes as a path of its own: each
 * optional param gives the path that ends before it.
 */
function withoutOptionalParams(pattern: string) {
  const segments = pattern.split('/')

  return segments.flatMap((segment, index) => {
    const optional = /^:(.+)\?$/.exec(segment)

    return optional
      ? [{ pattern: segments.slice(0, index).join('/') || '/', omitted: optional[1]! }]
      : []
  })
}

/**
 * Scans the committed router with the same routes scanner the dev server feeds
 * Tuyau, so both see the same request and response types.
 */
export async function collectRoutes(
  appRoot: string,
  router: Router,
  config: OpenApiConfig,
  diagnostics: Diagnostic[],
): Promise<RouteOperation[]> {
  const live = router.toJSON()

  const routes = Object.values(live).flat()

  const middlewareByRoute = new Map<
    string,
    Pick<RouteOperation, 'middleware' | 'inlineMiddleware'>
  >()

  for (const route of routes) {
    const entries = [...route.middleware.all()]

    middlewareByRoute.set(routeKey(route), {
      middleware: entries.flatMap(entry => ('name' in entry && entry.name ? [entry.name] : [])),
      // `node ace list:routes` names a function without a name `closure`.
      inlineMiddleware: entries.flatMap(entry =>
        entry instanceof Function
          ? [
              {
                name: entry.name || 'closure',
                source: entry.toString(),
                fn: entry,
              },
            ]
          : [],
      ),
    })
  }

  // A closure has no types to read, and the scanner keeps it when it is named.
  const controllerRoutes = Object.values(live).map(routes =>
    routes.filter(route => {
      if (!(route.handler instanceof Function)) return true

      if (!DOCS_ROUTES.has(route.name ?? '') && isIncluded(route.name ?? '', config.routes))
        diagnostics.push(closureRoute(route.name ?? `${route.methods.join(',')} ${route.pattern}`))

      return false
    }),
  )

  // Round-tripped through JSON like the dev server and `node ace codegen` do.
  const serialized: RoutesListItem[][] = JSON.parse(JSON.stringify(controllerRoutes))
  const scanner = new RoutesScanner(appRoot, [])
  scanner.filter(route => isIncluded(route.name ?? '', config.routes))

  for (const routes of serialized) await scanner.scan(routes)

  return scanner.getScannedRoutes().flatMap(route => {
    const [validator] = route.validators ?? []

    const methods = route.methods
      .map(method => method.toLowerCase())
      .filter((method): method is HttpMethod => METHODS.has(method))

    const operation = {
      name: route.name,
      methods,
      ...(middlewareByRoute.get(routeKey(route)) ?? {
        middleware: [],
        inlineMiddleware: [],
      }),
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

    // A `HEAD`-only route has no operation to document.
    if (!methods.length) return []

    const variants = [
      { pattern: route.pattern, operationId: route.name },
      ...withoutOptionalParams(route.pattern).map(({ pattern, omitted }) => ({
        pattern,
        operationId: `${route.name}.without_${omitted}`,
      })),
    ]

    return variants.map(({ pattern, operationId }): RouteOperation => {
      const path = toOpenApiPath(pattern)

      return {
        ...operation,
        operationId,
        path,
        pathParams: [...path.matchAll(/\{([^}]+)\}/g)].map(match => match[1]!),
      }
    })
  })
}
