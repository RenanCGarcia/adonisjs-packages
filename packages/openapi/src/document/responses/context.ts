import type ts from 'typescript'
import type { HandlerResponses } from '../../analysis/handler_responses.ts'
import type { AppTypes } from '../../program/app_types.ts'
import type { Diagnostic, ResponseSource } from '../../types.ts'
import type { RouteOperation } from '../../routes/route_operation.ts'
import type { Body, Outcomes } from '../outcome.ts'
import type { ResponseComponents } from '../response_components.ts'

/**
 * What every source of the responses of one route reads and adds to.
 */
export interface ResponseContext {
  route: RouteOperation
  app: AppTypes
  handler: HandlerResponses
  /**
   * Where the handler method is declared, which the return type documents.
   */
  returned: ResponseSource
  /**
   * The status a body returned or sent without one has: the one `response.status(...)` set, or `200`.
   */
  plain: string
  outcomes: Outcomes
  components: ResponseComponents
  diagnostics: Diagnostic[]
}

export function jsonBody({ app }: ResponseContext, type: ts.Type): Body {
  return { mediaType: 'application/json', schema: app.schemas.convert(type) }
}

/**
 * The exceptions an operation throws carry their own body, which the headers it sets do not reach.
 * `owner` is the class that describes the response, and `reason` describes it for this operation.
 */
export function addThrown(
  context: ResponseContext,
  source: ResponseSource,
  code: string,
  bodies: ts.Type[],
  { reason, owner }: { reason?: string; owner?: ts.Symbol } = {},
) {
  context.outcomes.add(code, source, {
    bodies: bodies.map(type => jsonBody(context, type)),
    reason,
    owner,
  })
}
