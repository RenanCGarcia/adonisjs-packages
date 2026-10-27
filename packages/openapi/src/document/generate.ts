import { fileURLToPath } from 'node:url'
import type { ApplicationService } from '@adonisjs/core/types'
import type { Router } from '@adonisjs/core/http'
import { operationDocs, type OperationDocs } from '../analysis/tags/operation_docs.ts'
import { lucidModel, noJsonSchema } from '../diagnostics/route.ts'
import { readApp } from '../program/app_types.ts'
import { collectRoutes } from '../routes/collect_routes.ts'
import type { Diagnostic, OpenApiConfig, OpenApiDocument, ResponseSource } from '../types.ts'
import { operationFor } from './operation.ts'
import { responsesFor } from './responses/responses.ts'
import { securityFor } from './security.ts'
import { bodyFields, mergeSchemas, validatorSchemas } from './validator_schemas.ts'

export interface GeneratedDocument {
  document: OpenApiDocument
  diagnostics: Diagnostic[]
  /**
   * Route name to status code to what documented that response, in the order it was read.
   */
  provenance: Record<string, Record<string, ResponseSource[]>>
}

const NO_DOCS: OperationDocs = { meta: {}, throws: [], responses: [], problems: [] }

export async function generateDocument(
  app: ApplicationService,
  router: Router,
  config: OpenApiConfig,
): Promise<GeneratedDocument> {
  const diagnostics: Diagnostic[] = []
  const appRoot = fileURLToPath(app.appRoot)
  const routes = await collectRoutes(appRoot, router, config, diagnostics)
  const types = readApp(appRoot, routes, config.errors, app.configPath('openapi.ts'))
  const vine = await validatorSchemas(app, routes, diagnostics)

  const paths: OpenApiDocument['paths'] = {}
  const provenance: GeneratedDocument['provenance'] = {}

  for (const route of routes) {
    const { request, response } = types.routeTypes(route.name)
    const input = request && mergeSchemas(vine.get(route.name), types.schemas.convert(request))
    const fields = input && bodyFields(input)
    const controller = types.handler(route)

    const docs = controller
      ? operationDocs(types.tags, controller.declaration, controller.method)
      : NO_DOCS

    diagnostics.push(
      ...docs.problems.map((problem): Diagnostic => ({ ...problem, route: route.name })),
    )

    const { secured, security } = securityFor(route, config.middlewareSecurity)

    const { responses, sources } = responsesFor(
      route,
      types,
      controller,
      response,
      docs,
      secured,
      diagnostics,
    )

    provenance[route.name] = sources

    const methods = paths[route.path] ?? {}
    paths[route.path] = methods

    for (const method of route.methods)
      methods[method] = operationFor(route, method, types, {
        meta: docs.meta,
        requestBody: docs.requestBody,
        input,
        fields,
        responses,
        security,
      })
  }

  diagnostics.push(...types.exceptions.diagnostics, ...types.errors.diagnostics)

  for (const type of types.schemas.unsupported) diagnostics.push(noJsonSchema(type))

  for (const model of types.schemas.models) diagnostics.push(lucidModel(model))

  const document: OpenApiDocument = {
    openapi: '3.1.0',
    info: config.info,
    paths,
    components: { schemas: types.schemas.components, securitySchemes: config.securitySchemes },
  }

  if (config.servers.length) document.servers = config.servers

  if (config.tags.length) document.tags = config.tags

  return { document, diagnostics, provenance }
}
