import ts from 'typescript'
import { join, relative } from 'node:path'
import { TypeToSchema } from './type_to_schema.ts'
import type { RouteOperation } from './types.ts'

/**
 * Resolves the request and response types of every route with the app's own
 * tsconfig, through one in-memory module that names them all.
 */
export class RouteTypes {
  readonly checker: ts.TypeChecker
  readonly schemas: TypeToSchema
  #routes: ts.InterfaceDeclaration
  #validationError?: ts.TypeAliasDeclaration

  constructor(appRoot: string, routes: RouteOperation[]) {
    const entryFile = join(appRoot, '.adonisjs/openapi/routes.ts')

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
      rootNames: [...config.fileNames, entryFile],
      options: { ...config.options, noEmit: true },
      host,
    })

    this.checker = program.getTypeChecker()
    this.schemas = new TypeToSchema(this.checker)

    const entry = program.getSourceFile(entryFile)!
    this.#routes = entry.statements.find(ts.isInterfaceDeclaration)!
    this.#validationError = entry.statements.find(ts.isTypeAliasDeclaration)
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

  return [...imports, validationError, `export interface Routes {\n${members.join('\n')}\n}`].join(
    '\n',
  )
}
