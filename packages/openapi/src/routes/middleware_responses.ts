import ts from 'typescript'
import type { Answer } from '../analysis/answers.ts'
import type { ConfiguredErrors } from '../analysis/errors/configured_errors.ts'
import type { ExceptionResponses } from '../analysis/exceptions/exception_responses.ts'
import { handlerResponses } from '../analysis/handler_responses.ts'
import type { RouteOperation, SourceLocation } from '../types.ts'
import type { Kernel } from './kernel.ts'

/**
 * What the route's middleware answer with when they stop the request, such as the `400` of
 * `response.badRequest(...)` in a tenant middleware, and what the package middleware an
 * `errors.middleware` key names throw. Only answers with a status are kept.
 */
export class MiddlewareResponses {
  #checker: ts.TypeChecker
  #kernel: Kernel
  #instanceOf: (specifier: string) => ts.Type | undefined
  #exceptions: ExceptionResponses
  #errors: ConfiguredErrors
  #locate: (node: ts.Node) => SourceLocation
  #answers = new Map<string, Answer[]>()

  constructor(
    checker: ts.TypeChecker,
    kernel: Kernel,
    instanceOf: (specifier: string) => ts.Type | undefined,
    exceptions: ExceptionResponses,
    errors: ConfiguredErrors,
    locate: (node: ts.Node) => SourceLocation,
  ) {
    this.#checker = checker
    this.#kernel = kernel
    this.#instanceOf = instanceOf
    this.#exceptions = exceptions
    this.#errors = errors
    this.#locate = locate
  }

  #answersOf(specifier: string) {
    let found = this.#answers.get(specifier)

    if (!found) {
      const instance = this.#instanceOf(specifier)
      const read = instance && handlerResponses(this.#checker, instance, 'handle')
      found = read ? [...read.answers, ...this.#exceptions.thrownAnswers(read.throws)] : []
      this.#answers.set(specifier, found)
    }

    return found
  }

  of(route: RouteOperation) {
    const specifiers = [
      ...this.#kernel.global,
      ...route.middleware.flatMap(name => this.#kernel.named.get(name) ?? []),
    ]

    const read = specifiers.flatMap(specifier =>
      this.#answersOf(specifier).flatMap(({ code, body, node }) =>
        code === undefined
          ? []
          : [{ code, body, middleware: specifier, location: this.#locate(node) }],
      ),
    )

    return [
      ...read,
      ...this.#errors.middlewareResponses(new Set([...specifiers, ...route.middleware])),
    ]
  }
}
