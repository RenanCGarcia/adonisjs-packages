import type { JsonSchema, OpenApiParameter } from '../types.ts'
import type { RouteOperation } from '../routes/route_operation.ts'

export function parametersFor(route: RouteOperation, query?: JsonSchema, params?: JsonSchema) {
  const path = route.pathParams.map((name): OpenApiParameter => ({
    name,
    in: 'path',
    required: true,
    schema: params?.properties?.[name] ?? { type: 'string' },
  }))

  const search = Object.entries(query?.properties ?? {}).map(([name, schema]): OpenApiParameter => {
    const parameter: OpenApiParameter = {
      name,
      in: 'query',
      required: query?.required?.includes(name) ?? false,
      schema,
    }

    // The query string parser reads an object from `filter[status]=x`.
    const object =
      schema.type === 'object' || (Array.isArray(schema.type) && schema.type.includes('object'))

    return object ? { ...parameter, style: 'deepObject', explode: true } : parameter
  })

  return [...path, ...search]
}
