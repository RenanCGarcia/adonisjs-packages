import Ticket from '#models/inbox/ticket'
import { messageValidator } from '#validators/inbox'
import type { HttpContext } from '@adonisjs/core/http'
import inbox from '@enzopita/adonisjs-inbox/services/main'

export default class InboxMessagesController {
  async store({ params, request, response, auth }: HttpContext) {
    const ticket = await Ticket.findOrFail(params.id)
    const { text } = await request.validateUsing(messageValidator)
    const me = await inbox.attendants.forUser(auth.getUserOrFail().id)

    const result = await inbox.messages.send(ticket.id, { text }, me, {
      clientRef: request.header('idempotency-key'),
    })

    if (result.outcome === 'rejected') return response.conflict({ reason: result.reason })

    return response.created(result)
  }
}
