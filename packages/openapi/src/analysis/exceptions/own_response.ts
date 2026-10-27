import ts from 'typescript'
import type { ExceptionType } from './exception_class.ts'
import { methodBodies, responseCalls } from '../response_calls.ts'
import { property, statusOf } from '../symbols.ts'

export type Thrown = { code: string; bodies: ts.Type[] }

/**
 * What an exception answers with by itself: a helper such as `response.conflict(body)` in its
 * `handle()` carries its status and body, and `response.status(409).send(body)` gives them one
 * call each.
 *
 * The status of `send()` and `json()` is the type of `static status`, so `422`, `422 as const`, a
 * constant or an enum member all resolve; a plain `static status = 422` widens to `number`, so its
 * initializer is read instead, and without either the `response.status(...)` call gives it. Their
 * body is the return type of `toResponse()` when the class has one.
 */
export function exceptionResponse(
  checker: ts.TypeChecker,
  { constructor, instance }: ExceptionType,
): Thrown[] {
  const { calls } = responseCalls(checker, methodBodies(checker, instance, ['handle']))

  const called = (...names: string[]) =>
    calls.filter(({ name }) => names.includes(name)).map(({ call }) => call)

  const responses: Thrown[] = []

  for (const { call } of calls) {
    const type = checker.getTypeAtLocation(call)
    const code = statusOf(property(checker, type, '__status'))
    const body = call.arguments.length > 0 && property(checker, type, '__response')

    if (code) responses.push({ code, bodies: body ? [body] : [] })
  }

  const sends = called('send', 'json')
  const toResponse = checker.getPropertyOfType(instance, 'toResponse')
  const signature = toResponse && checker.getTypeOfSymbol(toResponse).getCallSignatures()[0]

  if (sends.length > 0 || signature || responses.length === 0) {
    const status = checker.getPropertyOfType(constructor, 'status')
    const declaration = status?.valueDeclaration

    const code =
      statusOf(status && checker.getTypeOfSymbol(status)) ??
      statusOf(
        declaration && ts.isPropertyDeclaration(declaration) && declaration.initializer
          ? checker.getTypeAtLocation(declaration.initializer)
          : undefined,
      ) ??
      called('status')
        .map(call => statusOf(checker.getTypeAtLocation(call.arguments[0]!)))
        .find(Boolean)

    const bodies = signature
      ? [checker.getAwaitedType(signature.getReturnType())!]
      : sends.flatMap(call =>
          call.arguments[0] ? [checker.getTypeAtLocation(call.arguments[0])] : [],
        )

    if (code) responses.push({ code, bodies })
  }

  return responses
}
