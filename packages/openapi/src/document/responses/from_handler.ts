import ts from 'typescript'
import { property } from '../../analysis/symbols.ts'
import type { ResponseSource } from '../../types.ts'
import type { Body } from '../outcome.ts'
import type { ResponseContext } from './context.ts'

const WITHOUT_BODY =
  ts.TypeFlags.Any | ts.TypeFlags.Unknown | ts.TypeFlags.Void | ts.TypeFlags.Undefined

// AdonisJS sends a string as `text/plain`, and a literal `content-type` header replaces either.
function handlerBody({ app, handler }: ResponseContext, type: ts.Type): Body {
  const text = type.flags & ts.TypeFlags.StringLike

  return {
    mediaType: handler.contentType ?? (text ? 'text/plain' : 'application/json'),
    schema: app.schemas.convert(type),
  }
}

function answer(
  context: ResponseContext,
  source: ResponseSource,
  code: string,
  body?: Body,
  headers: string[] = [],
) {
  context.outcomes.add(code, source, {
    bodies: body ? [body] : [],
    headers: [...context.handler.headers, ...headers],
  })
}

/**
 * The members of the type the handler returns: a response helper such as `response.created(body)`
 * carries its status and body, `null` is a `204`, and `void` or `undefined` leaves the body optional.
 */
export function fromReturnType(context: ResponseContext, response: ts.Type | undefined) {
  const { app, plain, returned, outcomes } = context
  let members: ts.Type[] = []

  if (response) members = response.isUnion() ? response.types : [response]

  let optional = false
  let returnsPlain = false

  for (const member of members) {
    const status = property(app.checker, member, '__status')
    const payload = property(app.checker, member, '__response')

    if (payload) {
      let code = plain

      if (status) code = status.isNumberLiteral() ? String(status.value) : 'default'

      answer(
        context,
        returned,
        code,
        payload.flags & WITHOUT_BODY ? undefined : handlerBody(context, payload),
      )
    } else if (member.flags & ts.TypeFlags.Null) answer(context, returned, '204')
    else if (member.flags & (ts.TypeFlags.Void | ts.TypeFlags.Undefined)) optional = true
    else if (!(member.flags & (ts.TypeFlags.Any | ts.TypeFlags.Unknown))) {
      returnsPlain = true
      answer(context, returned, plain, handlerBody(context, member))
    }
  }

  if (optional && returnsPlain) outcomes.markOptional(plain)
}

export function fromAnswers(context: ResponseContext) {
  for (const { code = context.plain, body, binary, headers, node } of context.handler.answers) {
    const payload = body && !(body.flags & WITHOUT_BODY) ? handlerBody(context, body) : undefined
    const source: ResponseSource = { kind: 'answer', location: context.app.locate(node) }

    const file = binary && { mediaType: binary, schema: { type: 'string', format: 'binary' } }

    answer(context, source, code, file || payload, headers)
  }
}
