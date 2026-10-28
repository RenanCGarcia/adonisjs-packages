import ts from 'typescript'
import type { Answer } from '../analysis/answers.ts'
import type { ConfiguredErrors } from '../analysis/errors/configured_errors.ts'
import type { ExceptionResponses } from '../analysis/exceptions/exception_responses.ts'
import { handlerResponses } from '../analysis/handler_responses.ts'
import { methodBodies } from '../analysis/response_calls.ts'
import { ambiguousInlineMiddleware, unmatchedInlineMiddleware } from '../diagnostics/route.ts'
import type { Diagnostic, SourceLocation } from '../types.ts'
import type { InlineMatch, InlineMiddleware } from './inline_middleware.ts'
import type { RouteOperation } from './route_operation.ts'
import type { Kernel } from './kernel.ts'

export interface MiddlewareResponse {
  code: string
  body?: ts.Type
  middleware: string
  owner?: ts.Symbol
  location?: SourceLocation
  preset?: string
}

/**
 * What the route's middleware answer with when they stop the request, such as the `400` of
 * `response.badRequest(...)` in a tenant middleware or in a function passed to `.use()`, and what
 * the package middleware an `errors.middleware` key or a package preset names throw. Only answers
 * with a status are kept.
 */
export class MiddlewareResponses {
  #checker: ts.TypeChecker
  #kernel: Kernel
  #instanceOf: (specifier: string) => ts.Type | undefined
  #exceptions: ExceptionResponses
  #errors: ConfiguredErrors
  #answers = new Map<string, Answer[]>()

  constructor(
    checker: ts.TypeChecker,
    kernel: Kernel,
    instanceOf: (specifier: string) => ts.Type | undefined,
    exceptions: ExceptionResponses,
    errors: ConfiguredErrors,
  ) {
    this.#checker = checker
    this.#kernel = kernel
    this.#instanceOf = instanceOf
    this.#exceptions = exceptions
    this.#errors = errors
  }

  /**
   * An answer of the middleware's own belongs to its class, `owner`, and a thrown one, or one of a
   * call an `errors.throwers` key names, to the class of the exception.
   */
  #read(bodies: ts.Node[], owner?: ts.Symbol): Answer[] {
    const read = handlerResponses(this.#checker, bodies)

    return [
      ...read.answers.map(answer => ({ ...answer, owner })),
      ...this.#exceptions.thrownAnswers(read.throws),
      ...this.#errors
        .throwerResponses(read.invoked)
        .flatMap(({ code, bodies, call, owner }) =>
          (bodies.length ? bodies : [undefined]).map(body => ({ code, body, node: call, owner })),
        ),
    ]
  }

  #answersOf(specifier: string) {
    let found = this.#answers.get(specifier)

    if (!found) {
      const instance = this.#instanceOf(specifier)
      found = instance
        ? this.#read(methodBodies(this.#checker, instance, ['handle']), instance.getSymbol())
        : []
      this.#answers.set(specifier, found)
    }

    return found
  }

  /**
   * The answers of the route's middleware, and a diagnostic for each function passed to `.use()`
   * whose answers cannot be read.
   */
  of(
    route: RouteOperation,
    locate: (node: ts.Node) => SourceLocation,
    findInline: (middleware: InlineMiddleware) => InlineMatch,
  ) {
    const specifiers = [
      ...this.#kernel.global,
      ...route.middleware.flatMap(name => this.#kernel.named.get(name) ?? []),
    ]

    const diagnostics: Diagnostic[] = []
    const created: { name: string; file: string }[] = []

    const inline = route.inlineMiddleware.flatMap(({ name, ...runtime }) => {
      const match = findInline(runtime)

      if (match.kind === 'found') return [{ middleware: name, answers: this.#read([match.body]) }]

      if (match.kind === 'ambiguous') {
        diagnostics.push(ambiguousInlineMiddleware(route.name, name, match.candidates.map(locate)))

        return []
      }

      if (this.#errors.hasMiddlewareKey(name)) return []

      if (match.kind === 'package' && this.#errors.createsMiddleware(match.file))
        created.push({ name, file: match.file })
      else diagnostics.push(unmatchedInlineMiddleware(route.name, name))

      return []
    })

    const read = [
      ...specifiers.map(specifier => ({
        middleware: specifier,
        answers: this.#answersOf(specifier),
      })),
      ...inline,
    ].flatMap(({ middleware, answers }) =>
      answers.flatMap(({ code, body, node, owner }) =>
        code === undefined ? [] : [{ code, body, middleware, owner, location: locate(node) }],
      ),
    )

    const responses: MiddlewareResponse[] = [
      ...read,
      ...this.#errors.middlewareResponses(new Set([...specifiers, ...route.middleware]), created),
    ]

    return { responses, diagnostics }
  }
}
