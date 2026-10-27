import type { JsonSchema, OpenApiDocument, OpenApiReference, OpenApiResponse } from '../types.ts'

const CODE_PROPERTY = 'code'

function literalCode(schema: JsonSchema) {
  const property = schema.properties?.[CODE_PROPERTY]

  return schema.required?.includes(CODE_PROPERTY) &&
    property?.type === 'string' &&
    property.const !== undefined
    ? String(property.const)
    : undefined
}

function isResponse(response: OpenApiResponse | OpenApiReference): response is OpenApiResponse {
  return !('$ref' in response)
}

function* bodies(response: OpenApiResponse) {
  for (const { schema } of Object.values(response.content ?? {}))
    if (schema) yield* schema.oneOf ?? [schema]
}

export function errorCodes(document: Pick<OpenApiDocument, 'paths' | 'components'>) {
  const codes = new Set<string>()

  const responses = [
    ...Object.values(document.paths).flatMap(methods =>
      Object.values(methods).flatMap(operation =>
        Object.entries(operation?.responses ?? {})
          .filter(([status]) => Number(status) >= 400)
          .map(([, response]) => response)
          .filter(isResponse),
      ),
    ),
    ...Object.values(document.components.responses ?? {}),
  ]

  for (const response of responses)
    for (const body of bodies(response)) {
      const code = literalCode(body)

      if (code) codes.add(code)
    }

  return [...codes].sort()
}
