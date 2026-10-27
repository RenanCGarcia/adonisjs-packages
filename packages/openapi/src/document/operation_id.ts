import type { HttpMethod, OpenApiConfig } from '../types.ts'
import type { RouteOperation } from '../routes/route_operation.ts'

export function operationIdFor(
  route: RouteOperation,
  method: HttpMethod,
  custom: OpenApiConfig['operationId'],
): string {
  if (!custom)
    return route.methods.length > 1 ? `${route.operationId}.${method}` : route.operationId

  const id = custom({ name: route.name, method, path: route.path })

  if (!id)
    throw new Error(
      `openapi: operationId() must return a non-empty string, it returned ${JSON.stringify(id)} for ${method.toUpperCase()} ${route.path}`,
    )

  return id
}
