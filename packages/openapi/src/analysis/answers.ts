import ts from 'typescript'
import { fileType } from './media_type.ts'
import type { ResponseCalls } from './response_calls.ts'
import { property, statusOf } from './symbols.ts'

export interface Answer {
  /**
   * Absent when the status is the one already set, as in `response.status(error.status).send(body)`.
   */
  code?: string
  body?: ts.Type
  /**
   * The media type of the bytes of a file or a stream, from `download()`, `attachment()` or `stream()`.
   */
  binary?: string
  headers?: string[]
  node: ts.Node
  exception?: string
}

function chainedStatus(checker: ts.TypeChecker, call: ts.CallExpression) {
  const receiver = ts.isPropertyAccessExpression(call.expression)
    ? call.expression.expression
    : undefined

  return receiver &&
    ts.isCallExpression(receiver) &&
    ts.isPropertyAccessExpression(receiver.expression) &&
    receiver.expression.name.text === 'status' &&
    receiver.arguments[0]
    ? statusOf(checker.getTypeAtLocation(receiver.arguments[0]))
    : undefined
}

/**
 * `abort()` and `redirect()` default to `400` and `302`, as `HttpResponse` does.
 */
export function answerOf(
  checker: ts.TypeChecker,
  name: string,
  call: ts.CallExpression,
): Omit<Answer, 'node'>[] {
  const args = call.arguments
  const typeOf = (index: number) => args[index] && checker.getTypeAtLocation(args[index])

  switch (name) {
    case 'send':
    case 'json': {
      const code = chainedStatus(checker, call)

      return args[0] ? [{ ...(code && { code }), body: typeOf(0) }] : []
    }

    case 'abort':
      return [{ code: statusOf(typeOf(1)) ?? '400', body: typeOf(0) }]
    case 'abortIf':
    case 'abortUnless':
      return [{ code: statusOf(typeOf(2)) ?? '400', body: typeOf(1) }]
    case 'redirect':
      return [{ code: statusOf(typeOf(2)) ?? '302', headers: ['Location'] }]
    case 'stream':
      return [{ binary: 'application/octet-stream' }]
    case 'download':
      return [{ binary: fileType(checker, args[0]) }]
    case 'attachment':
      return [{ binary: fileType(checker, args[0]), headers: ['Content-Disposition'] }]
  }

  const type = checker.getTypeAtLocation(call)
  const code = statusOf(property(checker, type, '__status'))
  const body = args[0] && property(checker, type, '__response')

  return code ? [{ code, ...(body && { body }) }] : []
}

export function answersOf(checker: ts.TypeChecker, calls: ResponseCalls['calls']): Answer[] {
  return calls.flatMap(({ name, call }) =>
    answerOf(checker, name, call).map(answer => ({ ...answer, node: call })),
  )
}
