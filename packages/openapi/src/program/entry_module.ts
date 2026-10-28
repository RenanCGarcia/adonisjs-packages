import ts from 'typescript'
import { join, relative } from 'node:path'
import type { RouteOperation } from '../routes/route_operation.ts'

/**
 * The names of the declarations the entry module exports, which `readEntry` finds the types of.
 */
const NAMES = {
  validationError: 'ValidationError',
  errorBody: 'ErrorBody',
  authErrorBody: 'AuthErrorBody',
  config: 'Config',
}

/**
 * The `HttpResponse` helpers that set a status code, as Tuyau types them minus the
 * informational and redirect ones. Declared here as well so apps without Tuyau get them.
 */
const RESPONSE_HELPERS = {
  ok: 200,
  created: 201,
  accepted: 202,
  nonAuthoritativeInformation: 203,
  noContent: 204,
  resetContent: 205,
  partialContent: 206,
  badRequest: 400,
  unauthorized: 401,
  paymentRequired: 402,
  forbidden: 403,
  notFound: 404,
  methodNotAllowed: 405,
  notAcceptable: 406,
  proxyAuthenticationRequired: 407,
  requestTimeout: 408,
  conflict: 409,
  gone: 410,
  lengthRequired: 411,
  preconditionFailed: 412,
  requestEntityTooLarge: 413,
  requestUriTooLong: 414,
  unsupportedMediaType: 415,
  requestedRangeNotSatisfiable: 416,
  expectationFailed: 417,
  unprocessableEntity: 422,
  tooManyRequests: 429,
  internalServerError: 500,
  notImplemented: 501,
  badGateway: 502,
  serviceUnavailable: 503,
  gatewayTimeout: 504,
  httpVersionNotSupported: 505,
}

export function renderEntry(
  entryFile: string,
  appRoot: string,
  routes: RouteOperation[],
  errorBody: string | undefined,
  configFile: string | undefined,
) {
  const toRelative = (expression: string) =>
    expression.replace(/import\('(app\/[^']+?)(\.ts)?'\)/g, (_, path: string) => {
      const target = relative(join(entryFile, '..'), join(appRoot, path))

      return `import('${target}.js')`
    })

  const imports = new Set(routes.flatMap(route => route.imports))

  // The paths of a route with an optional param share its name and its types.
  const named = new Map(routes.map(route => [route.name, route]))

  const members = [...named.values()].map(route => {
    const request = route.requestType ? `request: ${toRelative(route.requestType)}; ` : ''

    const response = route.responseType
      ? `response: Awaited<${toRelative(route.responseType)}>`
      : ''

    return `  ${JSON.stringify(route.name)}: { ${request}${response} }`
  })

  const validationError = routes.some(route => route.validator)
    ? `import type { SimpleError } from '@vinejs/vine/types'\nexport type ${NAMES.validationError} = { errors: SimpleError[] }`
    : ''

  const helpers = Object.entries(RESPONSE_HELPERS).map(
    ([name, status]) =>
      `    ${name}<T>(body?: T, etag?: boolean): { __response: T; __status: ${status} }`,
  )

  // Tuyau types `json()` as a `200`, but it keeps the status already set. Declared later, this overload is picked first.
  const json = '    json<T>(body: T, generateEtag?: boolean): { __response: T }'

  const augmentation = `declare module '@adonisjs/core/http' {\n  interface HttpResponse {\n${[...helpers, json].join('\n')}\n  }\n}`

  return [
    ...imports,
    validationError,
    `export type ${NAMES.errorBody} = ${errorBody ? toRelative(errorBody) : '{ message: string }'}`,
    `export type ${NAMES.authErrorBody} = { errors: { message: string }[] }`,
    configFile
      ? `export type ${NAMES.config} = typeof import('${relative(join(entryFile, '..'), configFile).replace(/\.ts$/, '.js')}').default`
      : '',
    augmentation,
    `export interface Routes {\n${members.join('\n')}\n}`,
  ].join('\n')
}

export interface EntryTypes {
  routes: ts.InterfaceDeclaration
  validationError?: ts.Type
  errorBody: ts.Type
  authErrorBody: ts.Type
  config?: ts.Type
}

export function readEntry(checker: ts.TypeChecker, entry: ts.SourceFile): EntryTypes {
  const aliases = entry.statements.filter(ts.isTypeAliasDeclaration)

  const typeOf = (name: string) => {
    const alias = aliases.find(candidate => candidate.name.text === name)

    return alias && checker.getTypeAtLocation(alias)
  }

  return {
    routes: entry.statements.find(ts.isInterfaceDeclaration)!,
    validationError: typeOf(NAMES.validationError),
    errorBody: typeOf(NAMES.errorBody)!,
    authErrorBody: typeOf(NAMES.authErrorBody)!,
    config: typeOf(NAMES.config),
  }
}
