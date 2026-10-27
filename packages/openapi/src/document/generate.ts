import { fileURLToPath } from 'node:url'
import type { ApplicationService } from '@adonisjs/core/types'
import type { Router } from '@adonisjs/core/http'
import { operationDocs, type OperationDocs } from '../analysis/tags/operation_docs.ts'
import { lucidModel, noJsonSchema } from '../diagnostics/route.ts'
import { readApp } from '../program/app_types.ts'
import { collectRoutes } from '../routes/collect_routes.ts'
import type { Diagnostic, GeneratedDocument, OpenApiConfig, OpenApiDocument } from '../types.ts'
import { operationFor } from './operation.ts'
import { operationRules } from './operation_rules.ts'
import { ResponseComponents } from './response_components.ts'
import { responsesFor } from './responses/responses.ts'
import { securityFor } from './security.ts'
import { bodyFields, mergeSchemas, validatorSchemas } from './validator_schemas.ts'

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
  const components = new ResponseComponents(appRoot)

  // A route with an optional param has a path without it too, which shares everything else.
  for (const [name, variants] of Map.groupBy(routes, route => route.name)) {
    const route = variants[0]!
    const { request, response } = types.routeTypes(name)
    const input = request && mergeSchemas(vine.get(name), types.schemas.convert(request))
    const fields = input && bodyFields(input)
    const controller = types.handler(route)

    const docs = controller
      ? operationDocs(types.tags, controller.declaration, controller.method)
      : NO_DOCS

    diagnostics.push(
      ...docs.problems.map((problem): Diagnostic => ({ ...problem, route: name })),
      ...operationRules(
        name,
        docs.meta,
        config,
        controller && types.locate(controller.method.name),
      ),
    )

    const { secured, security } = securityFor(route, config.security.middleware)

    const { responses, sources } = responsesFor(route, types, controller, response, docs, secured, {
      diagnostics,
      components,
    })

    provenance[name] = sources

    for (const variant of variants) {
      const methods = paths[variant.path] ?? {}
      paths[variant.path] = methods

      for (const method of variant.methods)
        methods[method] = operationFor(variant, method, types, {
          meta: docs.meta,
          requestBody: docs.requestBody,
          input,
          fields,
          responses,
          security,
        })
    }
  }

  diagnostics.push(...types.exceptions.diagnostics, ...types.errors.diagnostics)

  for (const type of types.schemas.unsupported) diagnostics.push(noJsonSchema(type))

  for (const model of types.schemas.models) diagnostics.push(lucidModel(model))

  const responses = components.responses()

  const document: OpenApiDocument = {
    openapi: '3.1.0',
    info: config.document.info,
    paths,
    components: {
      schemas: types.schemas.components,
      ...(Object.keys(responses).length > 0 && { responses }),
      securitySchemes: config.security.schemes,
    },
  }

  if (config.document.servers.length) document.servers = config.document.servers

  if (config.document.tags.length) document.tags = config.document.tags

  return {
    document,
    diagnostics,
    provenance,
  }
}
