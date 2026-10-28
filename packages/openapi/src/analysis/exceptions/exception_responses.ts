import ts from 'typescript'
import { ownBodyUndeclared } from '../../diagnostics/errors.ts'
import type { Diagnostic } from '../../types.ts'
import type { Answer } from '../answers.ts'
import { exceptionType, lineage, ownHandler, type ExceptionType } from './exception_class.ts'
import {
  exceptionHandlerAnswers,
  type ExceptionHandlerAnswers,
  type HandlerBranch,
} from './exception_handler.ts'
import { declaredStatus } from './exception_status.ts'
import { exceptionResponse, type Thrown } from './own_response.ts'

function bodiesFor(codes: string[], bodies: ts.Type[]): Thrown[] {
  return codes.map(code => ({ code, bodies }))
}

/**
 * What a branch of the handler sends: with the status it sets, or else the one of the exception.
 */
function fromBranch({ answers }: HandlerBranch, codes: string[]): Thrown[] {
  const thrown = new Map<string, ts.Type[]>()

  for (const { code, body } of answers)
    for (const each of code ? [code] : codes) {
      const bodies = thrown.get(each) ?? []
      thrown.set(each, body ? [...bodies, body] : bodies)
    }

  return [...thrown].map(([code, bodies]) => ({ code, bodies }))
}

function withFallThrough(fallThrough: HandlerBranch[], codes: string[], rest: Thrown[]) {
  const thrown = new Map<string, ts.Type[]>()

  for (const { code, bodies } of [
    ...fallThrough.flatMap(branch => fromBranch(branch, codes)),
    ...rest,
  ])
    thrown.set(code, [...(thrown.get(code) ?? []), ...bodies])

  return [...thrown].map(([code, bodies]) => ({ code, bodies }))
}

/**
 * What the app sends when an exception reaches its exception handler.
 */
export class ExceptionResponses {
  #checker: ts.TypeChecker
  #handler: ExceptionHandlerAnswers
  /**
   * The body of an error the exception handler renders with no branch for its class.
   */
  readonly generic: ts.Type[]
  /**
   * The bodies a package exception's own `handle()` sends, which its declaration file does not
   * carry, by the symbol of its class.
   */
  #packaged: Map<ts.Symbol, ts.Type[]>
  /**
   * Vine's `E_VALIDATION_ERROR`, which the framework's handler renders itself, with the body it sends.
   */
  #validation?: { symbol: ts.Symbol; body?: ts.Type }
  #declared = new Map<ts.Symbol, string | undefined>()
  #undeclared = new Set<string>()
  readonly diagnostics: Diagnostic[] = []

  constructor(
    checker: ts.TypeChecker,
    handler: ExceptionHandlerAnswers,
    generic: ts.Type[],
    packaged: Map<ts.Symbol, ts.Type[]>,
    validation?: { symbol: ts.Symbol; body?: ts.Type },
  ) {
    this.#checker = checker
    this.#handler = handler
    this.generic = generic
    this.#packaged = packaged
    this.#validation = validation
  }

  /**
   * The branches whose `instanceof` names the exception, its class or a class it extends, and that
   * send a response, up to the first that does not fall through: one that sends nothing, such as one
   * that only sets a header, falls through to the next. A constant such as `E_ROW_NOT_FOUND` only
   * matches itself: `createError()` types every constant it makes as the same `Exception`.
   */
  #branches(branches: HandlerBranch[], exception: ExceptionType) {
    const extended = lineage(this.#checker, exception.instance)

    const matching = branches.filter(({ symbol, answers }) => {
      if (!answers.length) return false

      const named =
        symbol.flags & ts.SymbolFlags.Class
          ? symbol
          : this.#checker.getTypeOfSymbol(symbol).getSymbol()

      return (
        symbol === exception.symbol ||
        (named && named.flags & ts.SymbolFlags.Class && extended.has(named))
      )
    })

    const last = matching.findIndex(({ fallsThrough }) => !fallsThrough)

    return {
      fallsThrough: last === -1 ? matching : matching.slice(0, last),
      branch: last === -1 ? undefined : matching[last],
    }
  }

  #packagedBody(exception: ExceptionType, codes: string[]) {
    const packaged = exception.symbol && this.#packaged.get(exception.symbol)

    if (packaged) return bodiesFor(codes, packaged)

    if (!this.#undeclared.has(exception.name)) {
      this.#undeclared.add(exception.name)
      this.diagnostics.push(ownBodyUndeclared(exception.name))
    }

    return bodiesFor(codes, [])
  }

  /**
   * The status is the class default, else `status`, else the one its source declares, which for a
   * package class only its JavaScript carries. The body is what
   * an `instanceof` branch of the handler's `handle()` sends, else what the exception's own
   * `handle()` sends, else what a branch of `renderErrorAsJSON()` sends, else the generic body: the
   * order the framework's `ExceptionHandler` runs them in.
   */
  responses(exception: ExceptionType, status?: string): Thrown[] {
    const own = exceptionResponse(this.#checker, exception)
    let codes = [...new Set(own.map(({ code }) => code))]

    if (!codes.length) {
      const declared = status ?? this.#declaredStatus(exception)

      if (declared) codes = [declared]
    }

    if (!codes.length) return []

    const handled = this.#branches(this.#handler.handled, exception)

    return withFallThrough(
      handled.fallsThrough,
      codes,
      this.#afterFallThrough(exception, codes, own, handled.branch),
    )
  }

  // Reading a package class parses its JavaScript, and a shared app function throws it on many routes.
  #declaredStatus(exception: ExceptionType) {
    const { symbol } = exception

    if (!symbol) return declaredStatus(this.#checker, exception)

    if (!this.#declared.has(symbol))
      this.#declared.set(symbol, declaredStatus(this.#checker, exception))

    return this.#declared.get(symbol)
  }

  #afterFallThrough(
    exception: ExceptionType,
    codes: string[],
    own: Thrown[],
    handled?: HandlerBranch,
  ) {
    if (handled) return fromBranch(handled, codes)

    const handle = ownHandler(this.#checker, exception.instance)

    if (handle === 'read') return own.length ? own : bodiesFor(codes, [])

    if (handle === 'unread') return this.#packagedBody(exception, codes)

    // The framework matches its `code`, so a subclass and vine's exported class render the same.
    if (this.#validation && lineage(this.#checker, exception.instance).has(this.#validation.symbol))
      return bodiesFor(codes, this.#validation.body ? [this.#validation.body] : [])

    const rendered = this.#branches(this.#handler.rendered, exception)

    return withFallThrough(
      rendered.fallsThrough,
      codes,
      rendered.branch ? fromBranch(rendered.branch, codes) : bodiesFor(codes, this.generic),
    )
  }

  thrownAnswers(throws: ts.NewExpression[]): Answer[] {
    return throws.flatMap(expression => {
      const exception = exceptionType(
        this.#checker,
        this.#checker.getSymbolAtLocation(expression.expression),
      )

      if (!exception) return []

      const thrown = {
        node: expression,
        exception: expression.expression.getText(),
        owner: exception.symbol,
      }

      return this.responses(exception).flatMap(({ code, bodies }) =>
        bodies.length ? bodies.map(body => ({ ...thrown, code, body })) : [{ ...thrown, code }],
      )
    })
  }
}

/**
 * Reads the app's exception handler. `errorBody.type` is the generic body when the handler sends
 * none, and replaces the handler's own when `errors.body` names it (`overridesHandler`).
 */
export function readExceptionResponses(
  checker: ts.TypeChecker,
  handler: ts.Type | undefined,
  errorBody: { type: ts.Type; overridesHandler: boolean },
  packaged: Map<ts.Symbol, ts.Type[]>,
  validation?: { symbol: ts.Symbol; body?: ts.Type },
) {
  const answers = handler
    ? exceptionHandlerAnswers(checker, handler)
    : { handled: [], rendered: [], generic: [] }

  const sent = errorBody.overridesHandler ? [] : answers.generic.flatMap(({ body }) => body ?? [])

  return new ExceptionResponses(
    checker,
    answers,
    sent.length ? sent : [errorBody.type],
    packaged,
    validation,
  )
}
