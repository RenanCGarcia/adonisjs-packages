import ts from 'typescript'
import { exceptionType } from './exception_class.ts'
import { declaredStatus } from './exception_status.ts'
import type { ExceptionResponses } from './exception_responses.ts'
import type { Thrown } from './operation_docs.ts'
import { callMatches } from './throwers.ts'
import type { Diagnostic, ErrorsConfig, ResponseSource, SourceLocation } from './types.ts'

type Kind = 'throwers' | 'middleware'

/**
 * An exception an `errors.throwers` or `errors.middleware` entry names, with its class as the
 * type of the config reads it and the responses that class gives.
 */
export interface ConfiguredException {
  key: string
  name: string
  responses: Thrown[]
  location?: SourceLocation
}

/**
 * The exceptions the `errors` config names for the calls and the middleware the generator cannot
 * read, because their throw happens inside a package.
 */
export class ConfiguredErrors {
  #checker: ts.TypeChecker
  #errors: ErrorsConfig
  /**
   * The type of `config/openapi.ts`, absent when the app has none.
   */
  #config?: ts.Type
  #exceptions: ExceptionResponses
  #location: (node: ts.Node) => SourceLocation
  #entries = new Map<Kind, ConfiguredException[]>()
  #matched = new Set<string>()
  #problems: Diagnostic[] = []

  constructor(
    checker: ts.TypeChecker,
    errors: ErrorsConfig,
    config: ts.Type | undefined,
    exceptions: ExceptionResponses,
    location: (node: ts.Node) => SourceLocation,
  ) {
    this.#checker = checker
    this.#errors = errors
    this.#config = config
    this.#exceptions = exceptions
    this.#location = location
  }

  #property(type: ts.Type | undefined, name: string) {
    const symbol = type && this.#checker.getPropertyOfType(type, name)

    return symbol && this.#checker.getTypeOfSymbol(symbol)
  }

  #entriesOf(kind: Kind) {
    const cached = this.#entries.get(kind)

    if (cached) return cached

    const types = this.#property(this.#property(this.#config, 'errors'), kind)

    const entries = Object.entries(this.#errors[kind] ?? {}).map(
      ([key, value]): ConfiguredException => {
        const symbol = types && this.#checker.getPropertyOfType(types, key)
        const declaration = symbol?.valueDeclaration

        const initializer =
          declaration && ts.isPropertyAssignment(declaration) ? declaration.initializer : undefined

        const exception =
          exceptionType(
            this.#checker,
            initializer && this.#checker.getSymbolAtLocation(initializer),
          ) ?? exceptionType(this.#checker, symbol)

        const status = exception && declaredStatus(this.#checker, exception)

        const entry: ConfiguredException = {
          key,
          name: exception?.name ?? (value.name || key),
          responses: exception ? this.#exceptions.responses(exception, status) : [],
          ...(declaration && { location: this.#location(declaration) }),
        }

        if (!entry.responses.length)
          this.#problems.push({
            code: 'OA-E001',
            severity: 'warning',
            message: `errors.${kind}['${key}']: the status of ${entry.name} cannot be read, the entry is ignored`,
            fix: 'name an exception class with a numeric `status` field or `static status`',
            ...(entry.location && { location: entry.location }),
          })

        return entry
      },
    )

    this.#entries.set(kind, entries)

    return entries
  }

  /**
   * The `OA-E001` the entries raised, and an `OA-E003` for each key no route matched, such as a
   * misspelled `bouncer.authorise`. Read once every route is documented.
   */
  get diagnostics(): Diagnostic[] {
    const unmatched = (['throwers', 'middleware'] as const).flatMap(kind =>
      this.#entriesOf(kind)
        .filter(({ key }) => !this.#matched.has(`${kind}:${key}`))
        .map(({ key, location }): Diagnostic => ({
          code: 'OA-E003',
          severity: 'warning',
          message:
            kind === 'throwers'
              ? `errors.throwers['${key}'] matches no call of the documented routes`
              : `errors.middleware['${key}'] matches no middleware of the documented routes`,
          fix:
            kind === 'throwers'
              ? 'name the method, such as `findOrFail`, or the names the call goes through, such as `bouncer.authorize`'
              : 'name the middleware as `node ace list:routes` shows it, such as `auth` or `globalThrottle`, or its specifier in start/kernel.ts',
          ...(location && { location }),
        })),
    )

    return [...this.#problems, ...unmatched]
  }

  /**
   * What the calls an `errors.throwers` key names throw.
   */
  throwerResponses(invoked: ts.CallExpression[]) {
    return this.#entriesOf('throwers').flatMap(entry =>
      invoked
        .filter(call => callMatches(call, entry.key))
        .flatMap(call => {
          this.#matched.add(`throwers:${entry.key}`)

          const source: ResponseSource = {
            kind: 'thrower',
            call: entry.key,
            exception: entry.name,
            location: this.#location(call),
          }

          return entry.responses.map(thrown => ({ ...thrown, source }))
        }),
    )
  }

  /**
   * What the middleware an `errors.middleware` key names throw, for a route whose middleware go by
   * `names`: their names, as `node ace list:routes` shows them, and their kernel specifiers.
   */
  middlewareResponses(names: Set<string>) {
    return this.#entriesOf('middleware')
      .filter(({ key }) => names.has(key))
      .flatMap(entry => {
        this.#matched.add(`middleware:${entry.key}`)

        return entry.responses.flatMap(({ code, bodies }) =>
          (bodies.length ? bodies : [undefined]).map(body => ({
            code,
            body,
            middleware: entry.key,
            location: entry.location,
          })),
        )
      })
  }
}
