import ts from 'typescript'
import { exceptionType, type ExceptionType } from '../exceptions/exception_class.ts'
import type { ExceptionResponses } from '../exceptions/exception_responses.ts'
import type { Thrown } from '../exceptions/own_response.ts'
import { property } from '../symbols.ts'
import { arrayItems } from './array_items.ts'
import { callMatches } from './throwers.ts'
import { isPresetKey, type PresetException } from './presets.ts'
import {
  emptyEntry,
  entryStatusUnreadable,
  spreadUnreadable,
  unknownPresetKey,
  unmatchedKey,
  type ErrorsKind,
} from '../../diagnostics/errors.ts'
import type { Diagnostic, ErrorsConfig, ResponseSource, SourceLocation } from '../../types.ts'

/**
 * An exception an `errors.throwers` or `errors.middleware` entry names, with its class as the
 * type of the config reads it and the responses that class gives, or one a package preset names.
 */
export interface ConfiguredException {
  key: string
  name: string
  responses: Thrown[]
  owner?: ts.Symbol
  location?: SourceLocation
  preset?: PresetException
}

function isList<T>(value: T | readonly T[] | false): value is readonly T[] {
  return Array.isArray(value)
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
  #creators: PresetException[]
  #presets: ConfiguredException[]
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
    presets: PresetException[],
  ) {
    this.#checker = checker
    this.#errors = errors
    this.#config = config
    this.#exceptions = exceptions
    this.#location = location
    this.#creators = presets.filter(({ packageDir }) => packageDir)
    this.#presets = presets.flatMap(preset => {
      if (this.#errors[preset.kind]?.[preset.key] !== undefined) return []

      let responses: Thrown[] | undefined

      return [
        {
          key: preset.key,
          name: preset.exception.name,
          owner: preset.exception.symbol,
          preset,
          get responses() {
            return (responses ??= exceptions.responses(preset.exception))
          },
        },
      ]
    })
  }

  #entry(
    kind: ErrorsKind,
    key: string,
    runtimeName: string,
    exception: ExceptionType | undefined,
    declaration: ts.Node | undefined,
    index?: number,
  ): ConfiguredException {
    const entry: ConfiguredException = {
      key,
      name: exception?.name ?? (runtimeName || key),
      responses: exception ? this.#exceptions.responses(exception) : [],
      owner: exception?.symbol,
      ...(declaration && { location: this.#location(declaration) }),
    }

    if (!entry.responses.length)
      this.#problems.push(entryStatusUnreadable(kind, key, entry.name, entry.location, index))

    return entry
  }

  #entriesOf(kind: ErrorsKind) {
    const cached = this.#entries.get(kind)

    if (cached) return cached

    const types = property(this.#checker, property(this.#checker, this.#config, 'errors'), kind)

    const entries = Object.entries(this.#errors[kind] ?? {}).flatMap(
      ([key, value]): ConfiguredException[] => {
        const symbol = types && this.#checker.getPropertyOfType(types, key)
        const declaration = symbol?.valueDeclaration

        if (value === false) {
          if (!isPresetKey(kind, key))
            this.#problems.push(
              unknownPresetKey(kind, key, declaration && this.#location(declaration)),
            )

          return []
        }

        const initializer =
          declaration && ts.isPropertyAssignment(declaration) ? declaration.initializer : undefined

        if (isList(value)) {
          if (!value.length)
            this.#problems.push(emptyEntry(kind, key, declaration && this.#location(declaration)))

          const read = arrayItems(this.#checker, initializer, value.length)

          for (const spread of read?.unreadable ?? [])
            this.#problems.push(spreadUnreadable(kind, key, this.#location(spread)))

          const entry = (
            item: { name: string } | undefined,
            index: number,
            element?: ts.Expression,
          ) =>
            this.#entry(
              kind,
              key,
              item?.name ?? '',
              exceptionType(this.#checker, element && this.#checker.getSymbolAtLocation(element)),
              element ?? declaration,
              index,
            )

          if (!read) return value.map((item, index) => entry(item, index))

          return read.items.map(({ element, index, runtimeIndex }) =>
            entry(runtimeIndex === undefined ? undefined : value[runtimeIndex], index, element),
          )
        }

        const exception =
          exceptionType(
            this.#checker,
            initializer && this.#checker.getSymbolAtLocation(initializer),
          ) ?? exceptionType(this.#checker, symbol)

        return [this.#entry(kind, key, value.name, exception, declaration)]
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
      [...new Map(this.#entriesOf(kind).map(entry => [entry.key, entry.location]))].flatMap(
        ([key, location]) =>
          this.#matched.has(`${kind}:${key}`) ? [] : [unmatchedKey(kind, key, location)],
      ),
    )

    return [...this.#problems, ...unmatched]
  }

  throwerResponses(invoked: ts.CallExpression[]) {
    const presets = this.#presets.filter(({ preset }) => preset?.kind === 'throwers')

    return [...this.#entriesOf('throwers'), ...presets].flatMap(entry =>
      invoked
        .filter(call => callMatches(call, entry.key))
        .flatMap(call => {
          this.#matched.add(`throwers:${entry.key}`)

          const source: ResponseSource = {
            kind: 'thrower',
            call: entry.key,
            exception: entry.name,
            ...(entry.preset && { preset: entry.preset.package }),
            location: this.#location(call),
          }

          return entry.responses.map(thrown => ({ ...thrown, call, source, owner: entry.owner }))
        }),
    )
  }

  hasMiddlewareKey(name: string) {
    return this.#errors.middleware?.[name] !== undefined
  }

  #createdMiddlewareEntries(file: string) {
    const creator = this.#creators.find(({ packageDir }) => file.startsWith(packageDir!))

    if (!creator) return []

    const configured = this.#entriesOf('middleware').filter(({ key }) => key === creator.key)

    if (configured.length) this.#matched.add(`middleware:${creator.key}`)

    return configured.length ? configured : this.#presets.filter(({ preset }) => preset === creator)
  }

  createsMiddleware(file: string) {
    return this.#creators.some(({ packageDir }) => file.startsWith(packageDir!))
  }

  /**
   * What the middleware an `errors.middleware` key names throw, for a route whose middleware go by
   * `names`: their names, as `node ace list:routes` shows them, and their kernel specifiers. Then
   * what the function middleware a package created throw, `created` by their names and files.
   */
  middlewareResponses(names: Set<string>, created: { name: string; file: string }[]) {
    const named = this.#entriesOf('middleware')
      .filter(({ key }) => names.has(key))
      .map(entry => {
        this.#matched.add(`middleware:${entry.key}`)

        return { middleware: entry.key, entry }
      })

    const packaged = created.flatMap(({ name, file }) =>
      this.#createdMiddlewareEntries(file).map(entry => ({ middleware: name, entry })),
    )

    return [...named, ...packaged].flatMap(({ middleware, entry }) =>
      entry.responses.flatMap(({ code, bodies }) =>
        (bodies.length ? bodies : [undefined]).map(body => ({
          code,
          body,
          middleware,
          location: entry.location,
          owner: entry.owner,
          preset: entry.preset?.package,
        })),
      ),
    )
  }
}
