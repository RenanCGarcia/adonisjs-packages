import Queue from '#models/inbox/queue'
import Ticket from '#models/inbox/ticket'
import { assignValidator, closeValidator, transferValidator } from '#validators/inbox'
import type { HttpContext } from '@adonisjs/core/http'
import inbox from '@enzopita/adonisjs-inbox/services/main'
import type { Gesture } from '@enzopita/adonisjs-inbox/types'

export default class InboxTicketsController {
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
