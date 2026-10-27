import ts from 'typescript'
import { join, relative } from 'node:path'
import { existsSync } from 'node:fs'
import { property } from '../analysis/symbols.ts'
import { ConfiguredErrors } from '../analysis/errors/configured_errors.ts'
import { exceptionIndex } from '../analysis/exceptions/exception_index.ts'
import {
  readExceptionResponses,
  type ExceptionResponses,
} from '../analysis/exceptions/exception_responses.ts'
import { unauthorizedException } from '../analysis/exceptions/unauthorized.ts'
import type { TagContext } from '../analysis/tags/tag_context.ts'
import { readKernel } from '../routes/kernel.ts'
import { controllerHandler, type ControllerHandler } from '../routes/controller_handler.ts'
import { inlineMiddleware } from '../routes/inline_middleware.ts'
import { MiddlewareResponses } from '../routes/middleware_responses.ts'
import { TypeToSchema } from '../schema/type_to_schema.ts'
import type { ErrorsConfig, SourceLocation } from '../types.ts'
import type { RouteOperation } from '../routes/route_operation.ts'
import { createProgram } from './create_program.ts'
import { readEntry, renderEntry } from './entry_module.ts'
import { defaultInstance, moduleResolver } from './module_resolver.ts'
import { transformerTypes } from './transformer_names.ts'

/**
 * The request and response types of every route, the exceptions the app throws and what the app
 * answers with, read from the app's own program.
 */
export interface AppTypes {
  checker: ts.TypeChecker
  schemas: TypeToSchema
  exceptions: ExceptionResponses
  errors: ConfiguredErrors
  validationError?: ts.Type
  tags: Omit<TagContext, 'method' | 'problems'>
  locate: (node: ts.Node) => SourceLocation
  routeTypes: (routeName: string) => { request?: ts.Type; response?: ts.Type }
  handler: (route: RouteOperation) => ControllerHandler | undefined
  middlewareResponses: MiddlewareResponses['of']
  /**
   * The `401` of a secured route: what `E_UNAUTHORIZED_ACCESS` from `@adonisjs/auth` renders, through
   * a branch of the exception handler like any other exception.
   */
  unauthorizedResponses: () => ReturnType<ExceptionResponses['responses']>
}

/**
 * `configFile` is `config/openapi.ts`, whose type names the classes of `errors` when it exists.
 */
export function readApp(
  appRoot: string,
  routes: RouteOperation[],
  errors: ErrorsConfig,
  configFile?: string,
): AppTypes {
  const entryFile = join(appRoot, '.adonisjs/openapi/routes.ts')

  const source = renderEntry(
    entryFile,
    appRoot,
    routes,
    errors.body,
    configFile && existsSync(configFile) ? configFile : undefined,
  )

  const { program, options, dataFile } = createProgram(appRoot, entryFile, source)
  const checker = program.getTypeChecker()
  const entry = program.getSourceFile(entryFile)!
  const types = readEntry(checker, entry)

  const locate = (node: ts.Node): SourceLocation => {
    const file = node.getSourceFile()

    return {
      file: relative(appRoot, file.fileName),
      line: file.getLineAndCharacterOfPosition(node.getStart()).line + 1,
    }
  }

  const resolveModule = moduleResolver(program, checker)
  const kernelFile = program.getSourceFile(join(appRoot, 'start/kernel.ts'))
  const kernel = readKernel(kernelFile)
  const resolveFrom = kernelFile ?? entry

  const instanceOf = (specifier: string) =>
    defaultInstance(checker, resolveModule, specifier, resolveFrom)

  const unauthorized = unauthorizedException(program, checker, resolveFrom, {
    options,
    body: types.unauthorizedBody,
  })

  const exceptions = readExceptionResponses(
    checker,
    instanceOf(kernel.errorHandler ?? '#exceptions/handler'),
    { type: types.errorBody, overridesHandler: errors.body !== undefined },
    unauthorized.packaged,
  )

  const configured = new ConfiguredErrors(checker, errors, types.config, exceptions, locate)
  const named = new Map(transformerTypes(checker, program.getSourceFile(dataFile)))

  if (types.validationError) named.set(types.validationError, 'ValidationError')

  if (exceptions.generic.length === 1) named.set(exceptions.generic[0]!, 'Error')

  const middleware = new MiddlewareResponses(
    checker,
    kernel,
    instanceOf,
    exceptions,
    configured,
    locate,
    inlineMiddleware(program),
  )

  return {
    checker,
    schemas: new TypeToSchema(checker, named),
    exceptions,
    errors: configured,
    validationError: types.validationError,
    tags: {
      checker,
      resolveModule,
      findException: exceptionIndex(program, checker, appRoot),
      locate,
    },
    locate,
    routeTypes: routeName => {
      const member = types.routes.members.find(
        (candidate): candidate is ts.PropertySignature =>
          ts.isPropertySignature(candidate) &&
          ts.isStringLiteral(candidate.name) &&
          candidate.name.text === routeName,
      )

      if (!member) return {}

      const type = checker.getTypeAtLocation(member)

      return {
        request: property(checker, type, 'request'),
        response: property(checker, type, 'response'),
      }
    },
    handler: route => controllerHandler(program, checker, route),
    middlewareResponses: route => middleware.of(route),
    unauthorizedResponses: () =>
      unauthorized.exception ? exceptions.responses(unauthorized.exception, '401') : [],
  }
}
