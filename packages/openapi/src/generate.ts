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

interface Body {
  mediaType: string
  schema: JsonSchema
}

/**
 * Everything an operation can answer with under one status code. Every source (the return type,
 * the handler's own response calls, `@throws`, the validator, the middleware) adds to it, so
 * branches that share a status code all end up in its body.
 */
interface Outcome {
  /**
   * The descriptions `@throws` tags give, joined into the response description.
   */
  reasons: string[]
  bodies: Body[]
  headers: Set<string>
  /**
   * Whether the handler can also answer with no body, as when it returns `T | undefined`.
   */
  optional: boolean
}

const EMPTY_STATUSES = new Set(['204', '205', '304'])

const WITHOUT_BODY =
  ts.TypeFlags.Any | ts.TypeFlags.Unknown | ts.TypeFlags.Void | ts.TypeFlags.Undefined

const BINARY: Body = {
  mediaType: 'application/octet-stream',
  schema: { type: 'string', format: 'binary' },
}

/**
 * Bodies with the same schema, such as two exceptions rendered by the same handler, appear once.
 */
function render(code: string, { reasons, bodies, headers, optional }: Outcome): OpenApiResponse {
  const status = STATUS_CODES[Number(code)] ?? 'Response'
  const description = reasons.join('; ') || status

  const response: OpenApiResponse = {
    description: optional ? `${description}, or no body` : description,
  }

  if (headers.size)
    response.headers = Object.fromEntries(
      [...headers].map(name => [name, { schema: { type: 'string' } }]),
    )

  if (EMPTY_STATUSES.has(code) || !bodies.length) return response

  const content: NonNullable<OpenApiResponse['content']> = {}

  for (const mediaType of new Set(bodies.map(body => body.mediaType))) {
    const schemas = bodies.filter(body => body.mediaType === mediaType).map(body => body.schema)
    const unique = [...new Map(schemas.map(schema => [JSON.stringify(schema), schema])).values()]

    content[mediaType] = { schema: unique.length > 1 ? { oneOf: unique } : unique[0]! }
  }

  return { ...response, content }
}

function responsesFor(
  route: RouteOperation,
  types: RouteTypes,
  response: ts.Type | undefined,
  thrown: Record<string, ThrownResponse>,
  secured: boolean,
  warnings: string[],
) {
  const outcomes = new Map<string, Outcome>()
  const handler = types.handlerResponses(route)
  // A body returned or sent without a status keeps the one `response.status(...)` set.
  const plain = handler.status ?? '200'

  const outcome = (code: string) => {
    let found = outcomes.get(code)

    if (!found) {
      found = { reasons: [], bodies: [], headers: new Set(), optional: false }
      outcomes.set(code, found)
    }

    return found
  }

  const json = (type: ts.Type): Body => ({
    mediaType: 'application/json',
    schema: types.schemas.convert(type),
  })

  // AdonisJS sends a string as `text/plain`, and a literal `content-type` header replaces either.
  const handlerBody = (type: ts.Type): Body => {
    const text = type.flags & ts.TypeFlags.StringLike

    return {
      mediaType: handler.contentType ?? (text ? 'text/plain' : 'application/json'),
      schema: types.schemas.convert(type),
    }
  }

  const answer = (code: string, body?: Body, headers: string[] = []) => {
    const found = outcome(code)

    if (body) found.bodies.push(body)

    for (const header of [...handler.headers, ...headers]) found.headers.add(header)
  }

  let members: ts.Type[] = []

  if (response) members = response.isUnion() ? response.types : [response]

  let optional = false
  let returnsPlain = false

  for (const member of members) {
    const status = types.property(member, '__status')
    const payload = types.property(member, '__response')

    if (payload) {
      let code = plain

      if (status) code = status.isNumberLiteral() ? String(status.value) : 'default'

      answer(code, payload.flags & WITHOUT_BODY ? undefined : handlerBody(payload))
    } else if (member.flags & ts.TypeFlags.Null) answer('204')
    else if (member.flags & (ts.TypeFlags.Void | ts.TypeFlags.Undefined)) optional = true
    else if (!(member.flags & (ts.TypeFlags.Any | ts.TypeFlags.Unknown))) {
      returnsPlain = true
      answer(plain, handlerBody(member))
    }
  }

  for (const { code = plain, body, binary, headers } of handler.answers) {
    const payload = body && !(body.flags & WITHOUT_BODY) ? handlerBody(body) : undefined

    answer(code, binary ? BINARY : payload, headers)
  }

  if (optional && returnsPlain) outcome(plain).optional = true

  for (const { code = plain, body } of handler.thrown)
    outcome(code).bodies.push(...(body ? [json(body)] : []))

  const typed = outcomes.size > 0

  for (const [code, { description, bodies }] of Object.entries(thrown)) {
    const found = outcome(code)

    found.reasons.push(description)
    found.bodies.push(...bodies.map(json))
  }

  // The validator's error shares the status code an exception documents, so the body is either.
  const validationError = route.validator && types.validationError()

  if (validationError) outcome('422').bodies.push(json(validationError))

  for (const { code, body } of types.middlewareResponses(route))
    outcome(code).bodies.push(...(body ? [json(body)] : []))

  // An error the app answers without a documented body, such as a `@throws {404}` or the 401 of a
  // secured route, gets the body its exception handler renders.
  const { byCode, fallback } = types.errorResponses()

  if (secured) {
    const auth = types.unauthorizedBody()
    const unauthorized = byCode.get('401') ?? (auth ? [auth] : [])

    outcome('401').bodies.push(...unauthorized.map(json))
  }

  for (const [code, found] of outcomes) {
    if (Number(code) >= 400 && !found.bodies.length)
      found.bodies.push(...(byCode.get(code) ?? fallback).map(json))
  }

  if (!typed) {
    warnings.push(
      `${route.name}: the handler's return type is unknown, returning serialize(...) makes it typed`,
    )
    outcome('200')
  }

  return Object.fromEntries([...outcomes].map(([code, found]) => [code, render(code, found)]))
}

function parametersFor(route: RouteOperation, query?: JsonSchema, params?: JsonSchema) {
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

export async function generateDocument(
  app: ApplicationService,
  router: Router,
  config: OpenApiConfig,
): Promise<GeneratedDocument> {
  const warnings: string[] = []
  const appRoot = fileURLToPath(app.appRoot)
  const routes = await collectRoutes(appRoot, router, config, warnings)
  const types = new RouteTypes(appRoot, routes, config.errorResponse)
  const vine = await validatorSchemas(app, routes, warnings)

  const paths: OpenApiDocument['paths'] = {}

  for (const route of routes) {
    const { request, response } = types.get(route.name)
    const input = request && mergeSchemas(vine.get(route.name), types.schemas.convert(request))
    const fields = input && pick(input, key => !NOT_IN_BODY.has(key))

    const { responses: thrown, requestBody, problems, ...docs } = types.docs(route)

    warnings.push(...problems.map(problem => `${route.name}: ${problem}`))

    // Entries of `security` are alternatives, so the schemes a route requires together share one entry.
    const schemes = route.middleware.flatMap(name => config.middlewareSecurity[name] ?? [])

    const security: Record<string, string[]>[] = schemes.length
      ? [Object.fromEntries(schemes.map(scheme => [scheme, []]))]
      : []

    const responses = responsesFor(route, types, response, thrown, security.length > 0, warnings)

    const methods = paths[route.path] ?? {}
    paths[route.path] = methods

    for (const method of route.methods) {
      const readsQueryOnly = method === 'get' || method === 'options'
      const validated = readsQueryOnly ? undefined : fields
      const body = requestBody ? types.schemas.convert(requestBody) : validated

      const query = readsQueryOnly ? fields : input?.properties?.query
      const parameters = parametersFor(route, query, input?.properties?.params)

      const operation: OpenApiOperation = {
        operationId:
          route.methods.length > 1 ? `${route.operationId}.${method}` : route.operationId,
        ...docs,
        tags: docs.tags ?? [route.name.split('.')[0] ?? route.name],
        responses,
      }

      if (parameters.length) operation.parameters = parameters

      if (security.length) operation.security = security

      if (body) {
        const mediaType = JSON.stringify(body).includes('"format":"binary"')
          ? 'multipart/form-data'
          : 'application/json'

        operation.requestBody = { required: true, content: { [mediaType]: { schema: body } } }
      }

      methods[method] = operation
    }
  }

  for (const type of types.schemas.unsupported) {
    warnings.push(`no JSON Schema for the type ${type}, emitted {}`)
  }

  for (const model of types.schemas.models) {
    warnings.push(`${model} is a Lucid model, emitted {}: return it through a transformer`)
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
