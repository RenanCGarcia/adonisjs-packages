import ts from 'typescript'
import { answerOf, type Answer } from './answers.ts'
import { methodBodies, responseCalls } from './response_calls.ts'
import { statusOf } from './symbols.ts'

export interface HandlerResponses {
  answers: Answer[]
  /**
   * The exceptions the handler throws, which the headers it sets do not reach.
   */
  throws: ts.NewExpression[]
  invoked: ts.CallExpression[]
  headers: string[]
  /**
   * The literal `content-type` the handler sets, which every body it sends has.
   */
  contentType?: string
  /**
   * The literal of a `response.status(201)` call of its own, which a returned body is sent with.
   */
  status?: string
}

/**
 * What `method` of an action or a middleware answers with besides its return type: a helper such
 * as `response.forbidden(body)`, `send()` and `json()`, whose status is the literal of a
 * `response.status(403)` they are chained to, `abort()`, `redirect()`, and the exceptions it throws.
 */
export function handlerResponses(
  checker: ts.TypeChecker,
  instance: ts.Type,
  method: string,
): HandlerResponses {
  const { calls, throws, invoked } = responseCalls(
    checker,
    methodBodies(checker, instance, [method]),
  )

  const handler: HandlerResponses = { answers: [], throws, invoked, headers: [] }

  for (const { name, call } of calls) {
    const [first, second] = call.arguments

    if (name === 'header' || name === 'append' || name === 'safeHeader') {
      if (!first || !ts.isStringLiteralLike(first)) continue

      const value = second && checker.getTypeAtLocation(second)

      if (first.text.toLowerCase() !== 'content-type') handler.headers.push(first.text)
      else if (value?.isStringLiteral()) handler.contentType = value.value
    } else if (name === 'status' && ts.isExpressionStatement(call.parent)) {
      handler.status = first && statusOf(checker.getTypeAtLocation(first))
    } else
      handler.answers.push(
        ...answerOf(checker, name, call).map(answer => ({ ...answer, node: call })),
      )
  }

  return handler
}
