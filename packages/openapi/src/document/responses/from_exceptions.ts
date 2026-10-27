import type { ThrowsTag } from '../../analysis/tags/throws_tag.ts'
import { statuslessException } from '../../diagnostics/route.ts'
import { addThrown, type ResponseContext } from './context.ts'

/**
 * The `throw new X()` in the handler and in the app functions it calls.
 */
export function fromThrown(context: ResponseContext) {
  const { app, handler, plain } = context

  for (const { code = plain, body, node, exception = '', owner } of app.exceptions.thrownAnswers(
    handler.throws,
  ))
    addThrown(
      context,
      { kind: 'throw', exception, location: app.locate(node) },
      code,
      body ? [body] : [],
      { owner },
    )
}

/**
 * The calls an `errors.throwers` key names, which throw inside a package.
 */
export function fromThrowers(context: ResponseContext) {
  const { app, handler } = context

  for (const { code, bodies, source, owner } of app.errors.throwerResponses(handler.invoked))
    addThrown(context, source, code, bodies, { owner })
}

export function fromThrowsTags(context: ResponseContext, tags: ThrowsTag[]) {
  const { app, route, diagnostics } = context

  for (const { exception, reason, tag } of tags) {
    const responses = app.exceptions.responses(exception)
    const location = app.locate(tag)

    if (!responses.length)
      diagnostics.push(statuslessException(route.name, exception.name, location))

    for (const { code, bodies } of responses)
      addThrown(context, { kind: 'tag', tag: '@throws', location }, code, bodies, {
        reason,
        owner: exception.symbol,
      })
  }
}
