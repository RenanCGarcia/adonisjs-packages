import ts from 'typescript'
import { existsSync } from 'node:fs'
import { join, relative } from 'node:path'
import { readKernel, type Kernel } from './kernel.ts'
import { ConfiguredErrors } from './errors_config.ts'
import { exceptionIndex } from './exception_index.ts'
import { ExceptionResponses } from './exception_responses.ts'
import {
  answers,
  handlerResponses,
  operationDocs,
  type Answer,
  type HandlerResponses,
  type OperationDocs,
} from './operation_docs.ts'
import type { FindException } from './throws_tag.ts'
import { TypeToSchema } from './type_to_schema.ts'
import { unauthorizedException } from './unauthorized.ts'
import type { ErrorsConfig, RouteOperation, SourceLocation } from './types.ts'

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

/**
 * Resolves the request and response types of every route with the app's own
 * tsconfig, through one in-memory module that names them all.
 */
export class RouteTypes {
  readonly checker: ts.TypeChecker
  readonly schemas: TypeToSchema
  #program: ts.Program
  #appRoot: string
  #routes: ts.InterfaceDeclaration
  #validationError?: ts.TypeAliasDeclaration
  #errorBody: ts.Type
  #kernel: Kernel
  /**
   * Where the kernel's specifiers resolve from: `start/kernel.ts`, or the entry when the app has none.
   */
  #kernelFile: ts.SourceFile
  #answers = new Map<string, Answer[]>()
  #findException: FindException
  #unauthorized: ReturnType<typeof unauthorizedException>['exception']
  readonly exceptions: ExceptionResponses
  readonly errors: ConfiguredErrors

  /**
   * `configFile` is `config/openapi.ts`, whose type names the classes of `errors` when it exists.
   */
  constructor(
    appRoot: string,
    routes: RouteOperation[],
    errors: ErrorsConfig,
    configFile?: string,
  ) {
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

    const source = renderEntry(
      entryFile,
      appRoot,
      routes,
      errors.body,
      configFile && existsSync(configFile) ? configFile : undefined,
    )

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
    this.#appRoot = appRoot
    this.checker = program.getTypeChecker()
    this.#findException = exceptionIndex(program, this.checker, appRoot)

    const entry = program.getSourceFile(entryFile)!
    this.#routes = entry.statements.find(ts.isInterfaceDeclaration)!
    const aliases = entry.statements.filter(ts.isTypeAliasDeclaration)
    this.#validationError = aliases.find(alias => alias.name.text === 'ValidationError')
    this.#errorBody = this.checker.getTypeAtLocation(
      aliases.find(alias => alias.name.text === 'ErrorBody')!,
    )

    const kernelFile = program.getSourceFile(join(appRoot, 'start/kernel.ts'))
    this.#kernelFile = kernelFile ?? entry
    this.#kernel = readKernel(kernelFile)

    const configType = aliases.find(alias => alias.name.text === 'Config')

    const unauthorized = unauthorizedException(program, this.checker, this.#kernelFile, {
      options: config.options,
      body: this.checker.getTypeAtLocation(
        aliases.find(({ name }) => name.text === 'UnauthorizedBody')!,
      ),
    })

    this.#unauthorized = unauthorized.exception

    this.exceptions = ExceptionResponses.read(
      this.checker,
      this.#defaultInstance(this.#kernel.errorHandler ?? '#exceptions/handler'),
      this.#errorBody,
      errors.body !== undefined,
      unauthorized.packaged,
    )
    this.errors = new ConfiguredErrors(
      this.checker,
      errors,
      configType && this.checker.getTypeAtLocation(configType),
      this.exceptions,
      node => this.location(node),
    )

    const validationError = this.validationError()
    const named = new Map(this.#transformerTypes(program.getSourceFile(dataFile)))

    if (validationError) named.set(validationError, 'ValidationError')

    const { generic } = this.exceptions

    if (generic.length === 1) named.set(generic[0]!, 'Error')

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

  #resolveModule = (specifier: string, from: ts.SourceFile) => {
    const { resolvedModule } = ts.resolveModuleName(
      specifier,
      from.fileName,
      this.#program.getCompilerOptions(),
      ts.sys,
    )

    const file = resolvedModule && this.#program.getSourceFile(resolvedModule.resolvedFileName)

    return file && this.checker.getSymbolAtLocation(file)
  }

  /**
   * The instance type of the class a module of the app exports by default, such as a middleware.
   * Package modules are left out: only the app's own code is read.
   */
  #defaultInstance(specifier: string) {
    const module = this.#resolveModule(specifier, this.#kernelFile)
    const file = module?.valueDeclaration?.getSourceFile()

    if (!module || !file || file.isDeclarationFile || file.fileName.includes('/node_modules/'))
      return undefined

    const exported = this.checker.tryGetMemberInModuleExports('default', module)

    const symbol =
      exported && exported.flags & ts.SymbolFlags.Alias
        ? this.checker.getAliasedSymbol(exported)
        : exported

    return symbol && symbol.flags & ts.SymbolFlags.Class
      ? this.checker.getDeclaredTypeOfSymbol(symbol)
      : undefined
  }

  #answersOf(specifier: string) {
    let found = this.#answers.get(specifier)

    if (!found) {
      const instance = this.#defaultInstance(specifier)
      const read = instance && answers(this.checker, instance, ['handle'])
      found = read ? [...read.answers, ...this.exceptions.thrownAnswers(read.throws)] : []
      this.#answers.set(specifier, found)
    }

    return found
  }

  /**
   * What the route's middleware answer with when they stop the request, such as the `400` of
   * `response.badRequest(...)` in a tenant middleware, and what the package middleware an
   * `errors.middleware` key names throw. Only answers with a status are kept.
   */
  middlewareResponses(route: RouteOperation) {
    const specifiers = [
      ...this.#kernel.global,
      ...route.middleware.flatMap(name => this.#kernel.named.get(name) ?? []),
    ]

    const read = specifiers.flatMap(specifier =>
      this.#answersOf(specifier).flatMap(({ code, body, node }) =>
        code === undefined
          ? []
          : [{ code, body, middleware: specifier, location: this.location(node) }],
      ),
    )

    return [
      ...read,
      ...this.errors.middlewareResponses(new Set([...specifiers, ...route.middleware])),
    ]
  }

  location(node: ts.Node): SourceLocation {
    const file = node.getSourceFile()

    return {
      file: relative(this.#appRoot, file.fileName),
      line: file.getLineAndCharacterOfPosition(node.getStart()).line + 1,
    }
  }

  /**
   * Where the handler method is declared, absent for a route whose controller cannot be read.
   */
  handlerLocation(route: RouteOperation) {
    const handler = this.#handler(route)

    return handler && this.location(handler.method.name)
  }

  #handler({ controller }: RouteOperation) {
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

    return symbol && declaration && method ? { symbol, declaration, method } : undefined
  }

  /**
   * The doc comments on the handler, read from the controller class the file exports by default.
   */
  docs(route: RouteOperation): OperationDocs {
    const handler = this.#handler(route)

    return handler
      ? operationDocs(
          this.checker,
          this.#resolveModule,
          this.#findException,
          handler.declaration,
          handler.method,
        )
      : { throws: [], responses: [], problems: [] }
  }

  /**
   * What the handler answers with besides its return type, such as `response.send(body)`.
   */
  handlerResponses(route: RouteOperation): HandlerResponses {
    const handler = this.#handler(route)

    return handler
      ? handlerResponses(
          this.checker,
          this.checker.getDeclaredTypeOfSymbol(handler.symbol),
          handler.method.name.getText(),
        )
      : { answers: [], throws: [], invoked: [], headers: [] }
  }

  /**
   * The `401` of a secured route: what `E_UNAUTHORIZED_ACCESS` from `@adonisjs/auth` renders, through
   * a branch of the exception handler like any other exception.
   */
  unauthorizedResponses() {
    return this.#unauthorized ? this.exceptions.responses(this.#unauthorized, '401') : []
  }

  property(type: ts.Type, name: string) {
    const symbol = this.checker.getPropertyOfType(type, name)

    return symbol && this.checker.getTypeOfSymbol(symbol)
  }
}

function renderEntry(
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
    ? `import type { SimpleError } from '@vinejs/vine/types'\nexport type ValidationError = { errors: SimpleError[] }`
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
    `export type ErrorBody = ${errorBody ? toRelative(errorBody) : '{ message: string }'}`,
    'export type UnauthorizedBody = { errors: { message: string }[] }',
    configFile
      ? `export type Config = typeof import('${relative(join(entryFile, '..'), configFile).replace(/\.ts$/, '.js')}').default`
      : '',
    augmentation,
    `export interface Routes {\n${members.join('\n')}\n}`,
  ].join('\n')
}
