import ts from 'typescript'
import { exceptionType, lineage, ownHandler, type ExceptionType } from './exception_class.ts'
import {
  exceptionHandlerAnswers,
  type ExceptionHandlerAnswers,
  type HandlerBranch,
} from './exception_handler.ts'
import { exceptionResponse, type Answer, type Thrown } from './operation_docs.ts'
import type { Diagnostic } from './types.ts'

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
   * The `OA-E002` the exceptions read so far raised, once per class.
   */
  readonly diagnostics: Diagnostic[] = []

  constructor(
    checker: ts.TypeChecker,
    handler: ExceptionHandlerAnswers,
    generic: ts.Type[],
    packaged: Map<ts.Symbol, ts.Type[]>,
  ) {
    this.#checker = checker
    this.#handler = handler
    this.generic = generic
    this.#packaged = packaged
  }

  /**
   * Reads the app's exception handler. `fallback` is the generic body when the handler sends none,
   * and replaces the handler's own when `errors.body` names it.
   */
  static read(
    checker: ts.TypeChecker,
    handler: ts.Type | undefined,
    fallback: ts.Type,
    configured: boolean,
    packaged: Map<ts.Symbol, ts.Type[]>,
  ) {
    const answers = handler
      ? exceptionHandlerAnswers(checker, handler)
      : { handled: [], rendered: [], generic: [] }

    const sent = configured ? [] : answers.generic.flatMap(({ body }) => body ?? [])

    return new ExceptionResponses(checker, answers, sent.length ? sent : [fallback], packaged)
  }

  /**
   * The first branch whose `instanceof` names the exception, its class or a class it extends, and
   * that sends a response: one that sends nothing, such as one that only sets a header, falls
   * through to the next. A constant such as `E_ROW_NOT_FOUND` only matches itself: `createError()`
   * types every constant it makes as the same `Exception`.
   */
  #branch(branches: HandlerBranch[], exception: ExceptionType) {
    const extended = lineage(this.#checker, exception.instance)

    return branches.find(({ symbol, answers }) => {
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
  }

  /**
   * The status is the class default, or `status` for a class a package declares. The body is what
   * an `instanceof` branch of the handler's `handle()` sends, else what the exception's own
   * `handle()` sends, else what a branch of `renderErrorAsJSON()` sends, else the generic body: the
   * order the framework's `ExceptionHandler` runs them in.
   */
  responses(exception: ExceptionType, status?: string): Thrown[] {
    const own = exceptionResponse(this.#checker, exception)
    let codes = [...new Set(own.map(({ code }) => code))]

    if (!codes.length && status) codes = [status]

    if (!codes.length) return []

    const fromBranch = ({ answers }: HandlerBranch) => {
      const thrown = new Map<string, ts.Type[]>()

      for (const { code, body } of answers)
        for (const each of code ? [code] : codes) {
          const bodies = thrown.get(each) ?? []
          thrown.set(each, body ? [...bodies, body] : bodies)
        }

      return [...thrown].map(([code, bodies]) => ({ code, bodies }))
    }

    const handled = this.#branch(this.#handler.handled, exception)

    if (handled) return fromBranch(handled)

    switch (ownHandler(this.#checker, exception.instance)) {
      case 'read':
        return own.length ? own : codes.map(code => ({ code, bodies: [] }))
      case 'unread': {
        const packaged = exception.symbol && this.#packaged.get(exception.symbol)

        if (packaged) return codes.map(code => ({ code, bodies: packaged }))

        if (!this.diagnostics.some(({ message }) => message.startsWith(`${exception.name} `)))
          this.diagnostics.push({
            code: 'OA-E002',
            severity: 'warning',
            message: `${exception.name} renders its own body, which its package does not declare: it is documented without one`,
            fix: "render it in an `instanceof` branch of the exception handler's handle()",
          })

        return codes.map(code => ({ code, bodies: [] }))
      }
    }

    const rendered = this.#branch(this.#handler.rendered, exception)

    return rendered ? fromBranch(rendered) : codes.map(code => ({ code, bodies: this.generic }))
  }

  /**
   * What the `throw new X()` expressions answer with. A class without a status, such as a plain
   * `Error`, is left out.
   */
  thrownAnswers(throws: ts.NewExpression[]): Answer[] {
    return throws.flatMap(expression => {
      const exception = exceptionType(
        this.#checker,
        this.#checker.getSymbolAtLocation(expression.expression),
      )

      if (!exception) return []

      const thrown = { node: expression, exception: expression.expression.getText() }

      return this.responses(exception).flatMap(({ code, bodies }) =>
        bodies.length ? bodies.map(body => ({ ...thrown, code, body })) : [{ ...thrown, code }],
      )
    })
  }
}
