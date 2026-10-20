import Channel from '#models/inbox/channel'
import Flow from '#models/inbox/flow'
import FlowVersion from '#models/inbox/flow_version'
import Queue from '#models/inbox/queue'
import Ticket from '#models/inbox/ticket'
import {
  bindingsValidator,
  draftValidator,
  flowValidator,
  restoreValidator,
  startValidator,
} from '#validators/inbox_flows'
import type { HttpContext } from '@adonisjs/core/http'
import inbox from '@enzopita/adonisjs-inbox/services/main'
import inboxFlows from '@enzopita/adonisjs-inbox-flows/services/main'

export default class InboxFlowsController {
  catalog() {
    return inboxFlows.catalog()
  }

  async store({ request, response }: HttpContext) {
    const { name } = await request.validateUsing(flowValidator)

    return response.created(await inboxFlows.flows.create(name))
  }

  async show({ params }: HttpContext) {
    return inboxFlows.flows.get((await Flow.findOrFail(params.id)).id)
  }

  async saveDraft({ params, request, response }: HttpContext) {
    const flow = await Flow.findOrFail(params.id)
    const { graph, revision } = await request.validateUsing(draftValidator)
    const result = await inboxFlows.drafts.save(flow.id, graph, revision)

    if (result.outcome === 'stale') return response.conflict(result)

    if (result.outcome === 'invalid') return response.unprocessableEntity(result)

    return result
  }

  async validate({ params }: HttpContext) {
    return { problems: await inboxFlows.drafts.validate((await Flow.findOrFail(params.id)).id) }
  }

  async publish({ params, auth, response }: HttpContext) {
    const flow = await Flow.findOrFail(params.id)
    const result = await inboxFlows.publish(flow.id, auth.getUserOrFail().id)

    if (result.outcome === 'invalid') return response.unprocessableEntity(result)

    if (result.outcome === 'conflict') return response.conflict(result)

    return result.outcome === 'published' ? response.created(result) : result
  }

  async versions({ params }: HttpContext) {
    return inboxFlows.versions.list((await Flow.findOrFail(params.id)).id)
  }

  async restore({ params, request, response }: HttpContext) {
    const flow = await Flow.findOrFail(params.id)
    const version = await FlowVersion.findOrFail(params.versionId)
    const { revision } = await request.validateUsing(restoreValidator)
    const result = await inboxFlows.versions.restore(flow.id, version.id, revision)

    return result.outcome === 'stale' ? response.conflict(result) : result
  }

  async bindings({ params }: HttpContext) {
    return inboxFlows.bindings.list((await Flow.findOrFail(params.id)).id)
  }

  async setBindings({ params, request, response }: HttpContext) {
    const flow = await Flow.findOrFail(params.id)
    const { bindings } = await request.validateUsing(bindingsValidator)

    const inputs = await Promise.all(
      bindings.map(async ({ priority, channelId, queueId, condition }) => ({
        priority,
        channelId: channelId === null ? null : (await Channel.findOrFail(channelId)).id,
        queueId: queueId === null ? null : (await Queue.findOrFail(queueId)).id,
        condition,
      })),
    )

    const result = await inboxFlows.bindings.set(flow.id, inputs)

    return result.outcome === 'invalid' ? response.unprocessableEntity(result) : result
  }

  async start({ params, request, auth, response }: HttpContext) {
    const ticket = await Ticket.findOrFail(params.id)
    const { flowId } = await request.validateUsing(startValidator)
    const flow = await Flow.findOrFail(flowId)
    const me = await inbox.attendants.forUser(auth.getUserOrFail().id)
    const result = await inboxFlows.start(ticket.id, flow.id, me)

    return result.outcome === 'rejected' ? response.conflict(result) : response.created(result)
  }

  async stop({ params, auth, response }: HttpContext) {
    const ticket = await Ticket.findOrFail(params.id)
    const me = await inbox.attendants.forUser(auth.getUserOrFail().id)
    const result = await inboxFlows.stop(ticket.id, me)

    return result.outcome === 'not_running' ? response.notFound(result) : result
  }

  async runs({ params }: HttpContext) {
    return inboxFlows.runs.forTicket((await Ticket.findOrFail(params.id)).id)
  }
}
