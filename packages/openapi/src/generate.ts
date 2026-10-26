import { STATUS_CODES } from 'node:http'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'
import type { ApplicationService } from '@adonisjs/core/types'
import type { Router } from '@adonisjs/core/http'
import { collectRoutes } from './collect_routes.ts'
import type { ThrownResponse } from './operation_docs.ts'
import { RouteTypes } from './route_types.ts'
import type {
  JsonSchema,
  OpenApiConfig,
  OpenApiDocument,
  OpenApiOperation,
  OpenApiParameter,
  OpenApiResponse,
  RouteOperation,
} from './types.ts'

const NOT_IN_BODY = new Set(['query', 'params', 'headers', 'cookies'])

export interface GeneratedDocument {
  document: OpenApiDocument
  warnings: string[]
}

/**
 * Vine emits draft-7 object schemas, and every keyword JsonSchema names means the same there.
 */
interface VineValidator {
  toJSONSchema(): JsonSchema
}

/**
 * Vine knows the constraints (formats, bounds, enums) but has no JSON Schema for
 * files or custom rules and emits `{}` there: the TypeScript shape fills those gaps.
 */
function mergeSchemas(vine: JsonSchema | undefined, typed: JsonSchema): JsonSchema {
  if (!vine || !Object.keys(vine).length) return typed

  if (!vine.properties || !typed.properties) return vine

  const typedProperties = typed.properties

  const properties = Object.fromEntries(
    Object.entries(vine.properties).map(([key, schema]) => [
      key,
      mergeSchemas(schema, typedProperties[key] ?? {}),
    ]),
  )

  return { ...vine, properties }
}

function pick(schema: JsonSchema, keep: (key: string) => boolean): JsonSchema | undefined {
  const properties = Object.entries(schema.properties ?? {}).filter(([key]) => keep(key))

  if (!properties.length) return undefined

  const { required = [], ...rest } = schema
  const kept = required.filter(keep)

  return kept.length
    ? { ...rest, properties: Object.fromEntries(properties), required: kept }
    : { ...rest, properties: Object.fromEntries(properties) }
}

async function validatorSchemas(
  app: ApplicationService,
  routes: RouteOperation[],
  warnings: string[],
) {
  const schemas = new Map<string, JsonSchema>()

  for (const route of routes) {
    if (!route.validator) continue

    const { specifier, exportName } = route.validator

    try {
      // SAFETY: the routes scanner only reports values passed to `request.validateUsing()`, which are Vine validators.
      const module = (await app.import(specifier)) as Record<string, VineValidator>
      const validator = module[exportName]

      if (validator) schemas.set(route.name, validator.toJSONSchema())
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error)
      warnings.push(
        `${route.name}: cannot read the JSON Schema of ${specifier}#${exportName} (${reason})`,
      )
    }
  }

  return schemas
}

const EMPTY_STATUSES = new Set(['204', '205', '304'])

const WITHOUT_BODY =
  ts.TypeFlags.Any | ts.TypeFlags.Unknown | ts.TypeFlags.Void | ts.TypeFlags.Undefined

function responsesFor(
  route: RouteOperation,
  types: RouteTypes,
  response: ts.Type | undefined,
  thrown: Record<string, ThrownResponse>,
  secured: boolean,
  warnings: string[],
) {
  const responses: Record<string, OpenApiResponse> = {}

  const describe = (code: string, payload?: ts.Type) => {
    const description = STATUS_CODES[Number(code)] ?? 'Response'
    const empty = !payload || EMPTY_STATUSES.has(code) || payload.flags & WITHOUT_BODY

    responses[code] = empty
      ? { description }
      : { description, content: { 'application/json': { schema: types.schemas.convert(payload) } } }
  }

  let members: ts.Type[] = []

  if (response) members = response.isUnion() ? response.types : [response]

  for (const member of members) {
    const status = types.property(member, '__status')
    const payload = types.property(member, '__response')

    if (status && payload) {
      describe(status.isNumberLiteral() ? String(status.value) : 'default', payload)
    } else if (!(member.flags & (ts.TypeFlags.Any | ts.TypeFlags.Unknown))) {
      describe('200', member)
    }
  }

  const validationError = route.validator && types.validationError()

  for (const [code, { description, bodies }] of Object.entries(thrown)) {
    if (responses[code]) continue

    // The validator's error shares the status code an exception documents, so the body is either.
    const schemas = [
      ...bodies,
      ...(code === '422' && validationError ? [validationError] : []),
    ].map(body => types.schemas.convert(body))

    const schema = schemas.length > 1 ? { oneOf: schemas } : schemas[0]

    responses[code] = schema
      ? { description, content: { 'application/json': { schema } } }
      : { description }
  }

  if (validationError && !responses['422']) describe('422', validationError)

  if (secured && !responses['401']) describe('401')

  if (!Object.keys(responses).some(code => code.startsWith('2') || code === 'default')) {
    warnings.push(
      `${route.name}: the handler's return type is unknown, returning serialize(...) makes it typed`,
    )
    responses['200'] = { description: 'OK' }
  }

  return responses
}

function parametersFor(route: RouteOperation, query?: JsonSchema, params?: JsonSchema) {
  const path = route.pathParams.map((name): OpenApiParameter => ({
    name,
    in: 'path',
    required: true,
    schema: params?.properties?.[name] ?? { type: 'string' },
  }))

  const search = Object.entries(query?.properties ?? {}).map(
    ([name, schema]): OpenApiParameter => ({
      name,
      in: 'query',
      required: query?.required?.includes(name) ?? false,
      schema,
    }),
  )

  return [...path, ...search]
}

export async function generateDocument(
  app: ApplicationService,
  router: Router,
  config: OpenApiConfig,
): Promise<GeneratedDocument> {
  const warnings: string[] = []
  const appRoot = fileURLToPath(app.appRoot)
  const routes = await collectRoutes(appRoot, router, config)
  const types = new RouteTypes(appRoot, routes)
  const vine = await validatorSchemas(app, routes, warnings)

  const paths: OpenApiDocument['paths'] = {}

  for (const route of routes) {
    const { request, response } = types.get(route.name)
    const input = request && mergeSchemas(vine.get(route.name), types.schemas.convert(request))
    const readsQueryOnly = route.methods.every(method => method === 'get' || method === 'options')
    const fields = input && pick(input, key => !NOT_IN_BODY.has(key))

    const { responses: thrown, requestBody, problems, ...docs } = types.docs(route)

    warnings.push(...problems.map(problem => `${route.name}: ${problem}`))

    const validated = readsQueryOnly ? undefined : fields
    const body = requestBody ? types.schemas.convert(requestBody) : validated

    const query = readsQueryOnly ? fields : input?.properties?.query
    const parameters = parametersFor(route, query, input?.properties?.params)

    // Entries of `security` are alternatives, so the schemes a route requires together share one entry.
    const schemes = route.middleware.flatMap(name => config.middlewareSecurity[name] ?? [])

    const security: Record<string, string[]>[] = schemes.length
      ? [Object.fromEntries(schemes.map(scheme => [scheme, []]))]
      : []

    const operation: Omit<OpenApiOperation, 'operationId'> = {
      ...docs,
      tags: docs.tags ?? [route.name.split('.')[0] ?? route.name],
      responses: responsesFor(route, types, response, thrown, security.length > 0, warnings),
    }

    if (parameters.length) operation.parameters = parameters

    if (security.length) operation.security = security

    if (body) {
      const mediaType = JSON.stringify(body).includes('"format":"binary"')
        ? 'multipart/form-data'
        : 'application/json'

      operation.requestBody = { required: true, content: { [mediaType]: { schema: body } } }
    }

    const methods = paths[route.path] ?? {}
    paths[route.path] = methods

    for (const method of route.methods) {
      const operationId = route.methods.length > 1 ? `${route.name}.${method}` : route.name
      methods[method] = { operationId, ...operation }
    }
  }

  for (const type of types.schemas.unsupported) {
    warnings.push(`no JSON Schema for the type ${type}, emitted {}`)
  }

  const document: OpenApiDocument = {
    openapi: '3.1.0',
    info: config.info,
    paths,
    components: { schemas: types.schemas.components, securitySchemes: config.securitySchemes },
  }

  if (config.servers.length) document.servers = config.servers

  if (config.tags.length) document.tags = config.tags

  return { document, warnings }
}
