import Channel from '#models/inbox/channel'
import Contact from '#models/inbox/contact'
import Conversation from '#models/inbox/conversation'
import Queue from '#models/inbox/queue'
import { channelValidator, conversationValidator } from '#validators/inbox'
import type { HttpContext } from '@adonisjs/core/http'
import inbox from '@enzopita/adonisjs-inbox/services/main'
import { randomUUID } from 'node:crypto'

export default class InboxConversationsController {
  async storeChannel({ request, response }: HttpContext) {
    const {
      queueId,
      provider = 'fake',
      name = 'Playground',
    } = await request.validateUsing(channelValidator)
    const queue = await Queue.findOrFail(queueId)

    const channel = await Channel.create({
      provider,
      name,
      defaultQueueId: queue.id,
      webhookToken: randomUUID(),
      credentials: { secret: randomUUID() },
    })

    return response.created(channel)
  }

  /**
   * An agent reaching out to a contact, which opens a ticket in the channel's queue.
   */
  async store({ params, request, response, auth }: HttpContext) {
    const channel = await Channel.findOrFail(params.id)
    const { address } = await request.validateUsing(conversationValidator)
    const contact = await Contact.create({ channelId: channel.id, address })
    const conversation = await Conversation.create({ channelId: channel.id, contactId: contact.id })
    const me = await inbox.attendants.forUser(auth.getUserOrFail().id)

    return response.created(await inbox.tickets.open(conversation.id, channel.defaultQueueId, me))
  }

  async openTicket({ params, auth }: HttpContext) {
    const conversation = await Conversation.findOrFail(params.id)
    const channel = await Channel.findOrFail(conversation.channelId)
    const me = await inbox.attendants.forUser(auth.getUserOrFail().id)

    return inbox.tickets.open(conversation.id, channel.defaultQueueId, me)
  }
}
