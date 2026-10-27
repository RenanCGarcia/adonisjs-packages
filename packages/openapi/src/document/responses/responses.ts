import type ts from 'typescript'
import { handlerResponses } from '../../analysis/handler_responses.ts'
import { methodBodies } from '../../analysis/response_calls.ts'
import type { OperationDocs } from '../../analysis/tags/operation_docs.ts'
import { unknownReturnType } from '../../diagnostics/route.ts'
import type { AppTypes } from '../../program/app_types.ts'
import type { ControllerHandler } from '../../routes/controller_handler.ts'
import type { RouteOperation } from '../../routes/route_operation.ts'
import { Outcomes } from '../outcome.ts'
import type { ResponseContext } from './context.ts'
import { fromThrown, fromThrowers, fromThrowsTags } from './from_exceptions.ts'
import { fromAnswers, fromReturnType } from './from_handler.ts'
import { fromMiddleware, fromSecurity, fromValidator } from './from_request.ts'
import { fromResponseTags } from './from_tags.ts'

function contextFor(
  route: RouteOperation,
  app: AppTypes,
  controller: ControllerHandler | undefined,
  { diagnostics, components }: Pick<ResponseContext, 'diagnostics' | 'components'>,
): ResponseContext {
  const handler = controller
    ? handlerResponses(
        app.checker,
        methodBodies(app.checker, app.checker.getDeclaredTypeOfSymbol(controller.symbol), [
          controller.method.name.getText(),
        ]),
      )
    : { answers: [], throws: [], invoked: [], headers: [] }

  return {
    route,
    app,
    handler,
    returned: { kind: 'return', location: controller && app.locate(controller.method.name) },
    // A body returned or sent without a status keeps the one `response.status(...)` set.
    plain: handler.status ?? '200',
    outcomes: new Outcomes(),
    components,
    diagnostics,
  }
}

/**
 * The responses of an operation and where each came from, in the order the sources are read:
 * what the handler returns and sends, what it throws, then what runs around it.
 */
export function responsesFor(
  route: RouteOperation,
  app: AppTypes,
  controller: ControllerHandler | undefined,
  response: ts.Type | undefined,
  docs: Pick<OperationDocs, 'throws' | 'responses'>,
  secured: string[],
  shared: Pick<ResponseContext, 'diagnostics' | 'components'>,
) {
  const context = contextFor(route, app, controller, shared)
  const { diagnostics } = shared

  fromReturnType(context, response)
  fromAnswers(context)
  fromThrown(context)
  fromThrowers(context)
  fromThrowsTags(context, docs.throws)
  fromValidator(context)
  fromMiddleware(context)
  fromSecurity(context, secured)
  fromResponseTags(context, docs.responses)

  if (!context.outcomes.size) {
    diagnostics.push(unknownReturnType(route.name, context.returned.location))
    context.outcomes.add('200', context.returned)
  }

  return context.outcomes.render(context.components)
}
