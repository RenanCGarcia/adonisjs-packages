import ts from 'typescript'
import { existsSync } from 'node:fs'
import { join, relative } from 'node:path'
import { operationDocs, type OperationDocs } from './operation_docs.ts'
import { TypeToSchema } from './type_to_schema.ts'
import type { RouteOperation } from './types.ts'

/**
 * The `HttpResponse` helpers that set a status code, as Tuyau types them minus the
 * informational and redirect ones. Declared here as well so apps without Tuyau get them.
 */
const RESPONSE_HELPERS = {
  ok: 200,
  json: 200,
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

/**
 * Resolves the request and response types of every route with the app's own
 * tsconfig, through one in-memory module that names them all.
 */
export class RouteTypes {
  readonly checker: ts.TypeChecker
  readonly schemas: TypeToSchema
  #program: ts.Program
  #routes: ts.InterfaceDeclaration
  #validationError?: ts.TypeAliasDeclaration

  constructor(appRoot: string, routes: RouteOperation[]) {
    const entryFile = join(appRoot, '.adonisjs/openapi/routes.ts')
    const dataFile = join(appRoot, '.adonisjs/client/data.d.ts')

    const config = ts.getParsedCommandLineOfConfigFile(
      join(appRoot, 'tsconfig.json'),
      {},
      {
        ...ts.sys,
        onUnRecoverableConfigFileDiagnostic: diagnostic => {
          throw new Error(ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n'))
        },
      },
    )

    if (!config) throw new Error(`openapi: cannot read ${join(appRoot, 'tsconfig.json')}`)

    const source = renderEntry(entryFile, appRoot, routes)
    const host = ts.createCompilerHost(config.options)
    const getSourceFile = host.getSourceFile.bind(host)
    host.getSourceFile = (fileName, languageVersion, ...rest) =>
      fileName === entryFile
        ? ts.createSourceFile(fileName, source, languageVersion)
        : getSourceFile(fileName, languageVersion, ...rest)
    const fileExists = host.fileExists.bind(host)
    host.fileExists = fileName => fileName === entryFile || fileExists(fileName)

    // The app's own files carry the module augmentations (container bindings, auth guards) the types depend on.
    const program = ts.createProgram({
      rootNames: [...config.fileNames, entryFile, ...(existsSync(dataFile) ? [dataFile] : [])],
      options: { ...config.options, noEmit: true },
      host,
    })

    this.#program = program
    this.checker = program.getTypeChecker()

    const entry = program.getSourceFile(entryFile)!
    this.#routes = entry.statements.find(ts.isInterfaceDeclaration)!
    this.#validationError = entry.statements.find(ts.isTypeAliasDeclaration)

    const validationError = this.validationError()
    const named = new Map(this.#transformerTypes(program.getSourceFile(dataFile)))

    if (validationError) named.set(validationError, 'ValidationError')

    this.schemas = new TypeToSchema(this.checker, named)
  }

  /**
   * The types `node ace codegen` names in `Data`, keyed by their path below it (`Admin.User`).
   */
  #transformerTypes(dataFile: ts.SourceFile | undefined) {
    const module = dataFile && this.checker.getSymbolAtLocation(dataFile)
    const data = module && this.checker.tryGetMemberInModuleExports('Data', module)

    const walk = (namespace: ts.Symbol, path: string[]): [ts.Type, string][] =>
      this.checker.getExportsOfModule(namespace).flatMap(symbol => {
        if (symbol.name === 'Variants') return []

        const name = [...path, symbol.name]
        const nested = symbol.flags & ts.SymbolFlags.Namespace ? walk(symbol, name) : []

        if (!(symbol.flags & ts.SymbolFlags.TypeAlias)) return nested

        return [[this.checker.getDeclaredTypeOfSymbol(symbol), name.join('.')], ...nested]
      })

    return data ? walk(data, []) : []
  }

  /**
   * The types of one route's `request` and `response` members.
   */
  get(routeName: string) {
    const member = this.#routes.members.find(
      (candidate): candidate is ts.PropertySignature =>
        ts.isPropertySignature(candidate) &&
        ts.isStringLiteral(candidate.name) &&
        candidate.name.text === routeName,
    )

    if (!member) return {}

    const type = this.checker.getTypeAtLocation(member)

    return { request: this.property(type, 'request'), response: this.property(type, 'response') }
  }

  validationError() {
    return this.#validationError && this.checker.getTypeAtLocation(this.#validationError)
  }

  /**
   * The doc comments on the handler, read from the controller class the file exports by default.
   */
  docs({ controller }: RouteOperation): OperationDocs {
    const file = controller && this.#program.getSourceFile(controller.path)
    const module = file && this.checker.getSymbolAtLocation(file)
    const exported = module && this.checker.tryGetMemberInModuleExports('default', module)

    const symbol =
      exported && exported.flags & ts.SymbolFlags.Alias
        ? this.checker.getAliasedSymbol(exported)
        : exported

    const declaration = symbol?.declarations?.find(ts.isClassDeclaration)

    const method = declaration?.members.find(
      (member): member is ts.MethodDeclaration =>
        ts.isMethodDeclaration(member) &&
        ts.isIdentifier(member.name) &&
        member.name.text === controller?.method,
    )

    return declaration && method
      ? operationDocs(this.checker, declaration, method)
      : { responses: {}, problems: [] }
  }

  property(type: ts.Type, name: string) {
    const symbol = this.checker.getPropertyOfType(type, name)

    return symbol && this.checker.getTypeOfSymbol(symbol)
  }
}

function renderEntry(entryFile: string, appRoot: string, routes: RouteOperation[]) {
  const toRelative = (expression: string) =>
    expression.replace(/import\('(app\/[^']+?)(\.ts)?'\)/g, (_, path: string) => {
      const target = relative(join(entryFile, '..'), join(appRoot, path))

      return `import('${target}.js')`
    })

  const imports = new Set(routes.flatMap(route => route.imports))

  const members = routes.map(route => {
    const request = route.requestType ? `request: ${toRelative(route.requestType)}; ` : ''

    const response = route.responseType
      ? `response: Awaited<${toRelative(route.responseType)}>`
      : ''

    return `  ${JSON.stringify(route.name)}: { ${request}${response} }`
  })

  const validationError = routes.some(route => route.validator)
    ? `import type { SimpleError } from '@vinejs/vine/types'\nexport type ValidationError = { errors: SimpleError[] }`
    : ''

  const helpers = Object.entries(RESPONSE_HELPERS).map(
    ([name, status]) =>
      `    ${name}<T>(body?: T, etag?: boolean): { __response: T; __status: ${status} }`,
  )

  const augmentation = `declare module '@adonisjs/core/http' {\n  interface HttpResponse {\n${helpers.join('\n')}\n  }\n}`

  return [
    ...imports,
    validationError,
    augmentation,
    `export interface Routes {\n${members.join('\n')}\n}`,
  ].join('\n')
}
