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

const SCHEMA_REF = '#/components/schemas/'

export function errorCodes(document: Pick<OpenApiDocument, 'paths' | 'components'>) {
  const codes = new Set<string>()
  const seen = new Set<string>()

  function collect(schema: JsonSchema) {
    if (schema.$ref?.startsWith(SCHEMA_REF)) {
      const name = schema.$ref.slice(SCHEMA_REF.length)
      const target = document.components.schemas[name]

      if (target && !seen.has(name)) {
        seen.add(name)
        collect(target)
      }

      return
    }

    const code = literalCode(schema)

    if (code) codes.add(code)

    for (const entry of [...(schema.oneOf ?? []), ...(schema.anyOf ?? [])]) collect(entry)
  }

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
    for (const { schema } of Object.values(response.content ?? {})) if (schema) collect(schema)

  return [...codes].sort()
}
