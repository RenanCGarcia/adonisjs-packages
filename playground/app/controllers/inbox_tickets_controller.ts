import Queue from '#models/inbox/queue'
import Ticket from '#models/inbox/ticket'
import TicketTransformer from '#transformers/ticket_transformer'
import {
  assignValidator,
  closeValidator,
  ticketListValidator,
  transferValidator,
} from '#validators/inbox'
import type { HttpContext } from '@adonisjs/core/http'
import type { ModelQueryBuilderContract } from '@adonisjs/lucid/types/model'
import inbox from '@enzopita/adonisjs-inbox/services/main'
import inboxFlows from '@enzopita/adonisjs-inbox-flows/services/main'
import type { Gesture, TicketStatus } from '@enzopita/adonisjs-inbox/types'
import type { Infer } from '@vinejs/vine/types'

type TicketFilter = Omit<Infer<typeof ticketListValidator>, 'page' | 'perPage'>

function filtered({ status, queueId, assignee, channelId, search }: TicketFilter) {
  const query = Ticket.query()

  if (status !== undefined) query.whereIn('status', status)

  if (queueId !== undefined) query.where('queueId', queueId)

  if (assignee === 'unassigned') query.whereNull('assigneeId')
  else if (assignee === 'bot') query.where('assigneeKind', 'bot')
  else if (assignee !== undefined) query.where('assigneeId', assignee)

  if (channelId !== undefined) {
    query.whereHas('conversation', conversation => conversation.where('channelId', channelId))
  }

  if (search !== undefined) {
    query.whereHas('conversation', conversation =>
      conversation.whereHas('contact', contact =>
        contact.whereILike('name', `%${search}%`).orWhereILike('address', `%${search}%`),
      ),
    )
  }

  return query
}

/**
 * What the ticket transformer reads for a list row.
 */
function withRow(query: ModelQueryBuilderContract<typeof Ticket>) {
  return query
    .preload('queue')
    .preload('assignee', assignee => assignee.preload('user'))
    .preload('conversation', conversation => conversation.preload('contact').preload('channel'))
    .preload('messages', messages => messages.groupOrderBy('id', 'desc').groupLimit(1))
}

export default class InboxTicketsController {
  /**
   * One page of the tickets matching the filter, by last activity, and how many match it in
   * each status whatever the status filter.
   */
  async index({ request, serialize }: HttpContext) {
    const { page = 1, perPage = 25, ...filter } = await request.validateUsing(ticketListValidator)

    const tickets = await withRow(filtered(filter))
      .orderBy('lastActivityAt', 'desc')
      .orderBy('id', 'desc')
      .paginate(page, perPage)

    const rows = await filtered({ ...filter, status: undefined })
      .select('status')
      .count('* as total')
      .groupBy('status')

    const counts: Record<TicketStatus, number> = { queued: 0, in_progress: 0, closed: 0 }

    for (const row of rows) counts[row.state.status] = Number(row.$extras.total)

    return {
      ...(await serialize(TicketTransformer.paginate(tickets.all(), tickets.getMeta()))),
      counts,
    }
  }

  async show({ params, serialize }: HttpContext) {
    const ticket = await withRow(Ticket.query().where('id', params.id)).firstOrFail()

    await ticket.conversation.load('messages', messages =>
      messages.orderBy('id').preload('author', author => author.preload('user')),
    )
    await ticket.load('events', events =>
      events.orderBy('id').preload('actor', actor => actor.preload('user')),
    )

    return serialize({
      ticket: TicketTransformer.transform(ticket).useVariant('forDetail'),
      runs: await inboxFlows.runs.forTicket(ticket.id),
    })
  }

  async assume(ctx: HttpContext) {
    return this.#apply(ctx, { gesture: 'assume' })
  }

  async assign(ctx: HttpContext) {
    const { userId, bot } = await ctx.request.validateUsing(assignValidator)
    const to = bot ? await inbox.attendants.bot(bot) : await inbox.attendants.forUser(userId!)

    return this.#apply(ctx, { gesture: 'assign', to: to.id })
  }

  async transfer(ctx: HttpContext) {
    const { queueId, userId } = await ctx.request.validateUsing(transferValidator)
    const queue = await Queue.findOrFail(queueId)
    const to = userId === undefined ? undefined : await inbox.attendants.forUser(userId)

    return this.#apply(ctx, { gesture: 'transfer', queueId: queue.id, to: to?.id })
  }

  async requeue(ctx: HttpContext) {
    return this.#apply(ctx, { gesture: 'return' })
  }

  async close(ctx: HttpContext) {
    const { reason, note } = await ctx.request.validateUsing(closeValidator)

    return this.#apply(ctx, { gesture: 'close', reason, note })
  }

  async read({ params, auth, response }: HttpContext) {
    const ticket = await Ticket.findOrFail(params.id)

    await inbox.tickets.markRead(ticket.id, await inbox.attendants.forUser(auth.getUserOrFail().id))

    return response.noContent()
  }

  async #apply({ params, auth, response }: HttpContext, gesture: Gesture) {
    const ticket = await Ticket.findOrFail(params.id)
    const me = await inbox.attendants.forUser(auth.getUserOrFail().id)
    const result = await inbox.tickets.apply(ticket.id, gesture, me)

    if (result.outcome === 'rejected') return response.conflict({ reason: result.reason })

    return result
  }
}
