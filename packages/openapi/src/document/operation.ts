import type ts from 'typescript'
import type { OperationMeta } from '../analysis/tags/operation_docs.ts'
import type { AppTypes } from '../program/app_types.ts'
import type { HttpMethod, JsonSchema, OpenApiOperation } from '../types.ts'
import type { RouteOperation } from '../routes/route_operation.ts'
import { componentName } from './component_name.ts'
import { parametersFor } from './parameters.ts'

export interface OperationParts {
  meta: OperationMeta
  requestBody?: ts.Type
  input?: JsonSchema
  fields?: JsonSchema
  responses: OpenApiOperation['responses']
  security: Record<string, string[]>[]
  operationId: string
}

export function operationFor(
  route: RouteOperation,
  method: HttpMethod,
  app: AppTypes,
  { meta, requestBody, input, fields, responses, security, operationId }: OperationParts,
): OpenApiOperation {
  const parser = app.bodyParser
  const readsQueryOnly = !parser.methods.has(method.toUpperCase())
  const validated = readsQueryOnly ? undefined : fields
  const body = requestBody ? app.schemas.convert(requestBody) : validated

  const parameters = parametersFor(
    route,
    readsQueryOnly ? fields : undefined,
    input?.properties?.params,
  )

  const operation: OpenApiOperation = {
    operationId,
    ...meta,
    responses,
  }

  if (parameters.length) operation.parameters = parameters

  if (security.length) operation.security = security

  if (body) {
    const mediaTypes = JSON.stringify(body).includes('"format":"binary"')
      ? [parser.fileMediaType]
      : parser.mediaTypes(route.routerPattern)

    const schema =
      mediaTypes.length > 1 && !body.$ref ? shared(app, `${operationId}.body`, body) : body

    operation.requestBody = {
      required: true,
      content: Object.fromEntries(mediaTypes.map(mediaType => [mediaType, { schema }])),
    }
  }

  return operation
}

// orval types and sends a body listed inline under several media types as a union with no Content-Type.
function shared(app: AppTypes, id: string, schema: JsonSchema): JsonSchema {
  const { components } = app.schemas
  const base = componentName(id)
  let name = base

  for (let suffix = 2; components[name]; suffix++) name = `${base}_${suffix}`

  components[name] = schema

  return { $ref: `#/components/schemas/${name}` }
}
