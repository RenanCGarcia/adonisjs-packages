import { jsonBody, type ResponseContext } from './context.ts'

/**
 * The validator's error shares the status code an exception documents, so the body is either.
 */
export function fromValidator(context: ResponseContext) {
  const { app, route, outcomes } = context
  const validationError = route.validator && app.validationError

  if (validationError)
    outcomes.add('422', { kind: 'validator' }, { bodies: [jsonBody(context, validationError)] })
}

export function fromMiddleware(context: ResponseContext) {
  const { app, route, outcomes } = context
  const { responses, diagnostics } = app.middlewareResponses(route)

  context.diagnostics.push(...diagnostics)

  for (const { code, body, middleware, location, owner, preset } of responses)
    outcomes.add(
      code,
      {
        kind: 'middleware',
        middleware,
        ...(preset && { preset }),
        ...(location && { location }),
      },
      { bodies: body ? [jsonBody(context, body)] : [], owner },
    )
}

/**
 * The `401` of a secured route, with the body `E_UNAUTHORIZED_ACCESS` renders.
 */
export function fromSecurity(context: ResponseContext, secured: string[]) {
  const { app, outcomes } = context

  if (!secured.length) return

  const bodies = app
    .unauthorizedResponses()
    .filter(({ code }) => code === '401')
    .flatMap(response => response.bodies.map(type => jsonBody(context, type)))

  outcomes.add(
    '401',
    secured.map(middleware => ({ kind: 'security', middleware })),
    { bodies },
  )
}
