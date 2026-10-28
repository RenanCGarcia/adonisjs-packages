import ts from 'typescript'
import { exceptionType, type ExceptionType } from '../exceptions/exception_class.ts'
import { declaredStatus } from '../exceptions/exception_status.ts'
import type { ExceptionResponses } from '../exceptions/exception_responses.ts'
import type { Thrown } from '../exceptions/own_response.ts'
import { property } from '../symbols.ts'
import { callMatches } from './throwers.ts'
import { entryStatusUnreadable, unmatchedKey, type ErrorsKind } from '../../diagnostics/errors.ts'
import type { Diagnostic, ErrorsConfig, ResponseSource, SourceLocation } from '../../types.ts'

/**
 * An exception an `errors.throwers` or `errors.middleware` entry names, with its class as the
 * type of the config reads it and the responses that class gives.
 */
export interface ConfiguredException {
  key: string
  name: string
  responses: Thrown[]
  owner?: ts.Symbol
  location?: SourceLocation
}

/**
 * The exceptions the `errors` config names for the calls and the middleware the generator cannot
 * read, because their throw happens inside a package.
 */
export class ConfiguredErrors {
  #checker: ts.TypeChecker
  #errors: ErrorsConfig
  #config?: ts.Type
  #exceptions: ExceptionResponses
  #unauthorized?: ExceptionType
  #location: (node: ts.Node) => SourceLocation
  #entries = new Map<ErrorsKind, ConfiguredException[]>()
  #matched = new Set<string>()
  #problems: Diagnostic[] = []

  constructor(
    checker: ts.TypeChecker,
    errors: ErrorsConfig,
    config: ts.Type | undefined,
    exceptions: ExceptionResponses,
    location: (node: ts.Node) => SourceLocation,
    unauthorized?: ExceptionType,
  ) {
    this.#checker = checker
    this.#errors = errors
    this.#config = config
    this.#exceptions = exceptions
    this.#location = location
    this.#unauthorized = unauthorized
  }

  // `auth.getUserOrFail()` throws `E_UNAUTHORIZED_ACCESS` in every guard of `@adonisjs/auth`.
  #builtinThrowers(): ConfiguredException[] {
    const key = 'auth.getUserOrFail'
    const exception = this.#unauthorized

    if (!exception || this.#errors.throwers?.[key]) return []

    return [
      {
        key,
        name: exception.name,
        responses: this.#exceptions.responses(exception, '401'),
        owner: exception.symbol,
      },
    ]
  }

  #entriesOf(kind: ErrorsKind) {
    const cached = this.#entries.get(kind)

    if (cached) return cached

    const types = property(this.#checker, property(this.#checker, this.#config, 'errors'), kind)

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
          owner: exception?.symbol,
          ...(declaration && { location: this.#location(declaration) }),
        }

        if (!entry.responses.length)
          this.#problems.push(entryStatusUnreadable(kind, key, entry.name, entry.location))

        return entry
      },
    )

    this.#entries.set(kind, entries)

    return entries
  }

  /**
   * Read once every route is documented, so a key no route matched, such as a misspelled
   * `bouncer.authorise`, is known by then.
   */
  get diagnostics(): Diagnostic[] {
    const unmatched = (['throwers', 'middleware'] as const).flatMap(kind =>
      this.#entriesOf(kind)
        .filter(({ key }) => !this.#matched.has(`${kind}:${key}`))
        .map(({ key, location }) => unmatchedKey(kind, key, location)),
    )

    return [...this.#problems, ...unmatched]
  }

  throwerResponses(invoked: ts.CallExpression[]) {
    return [...this.#entriesOf('throwers'), ...this.#builtinThrowers()].flatMap(entry =>
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

          return entry.responses.map(thrown => ({ ...thrown, call, source, owner: entry.owner }))
        }),
    )
  }

  namesMiddleware(name: string) {
    return this.#entriesOf('middleware').some(({ key }) => key === name)
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
            owner: entry.owner,
          })),
        )
      })
  }
}
