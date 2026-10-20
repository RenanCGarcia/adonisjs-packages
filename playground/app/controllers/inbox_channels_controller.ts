import Channel from '#models/inbox/channel'
import Ticket from '#models/inbox/ticket'
import { writeIn } from '#services/fake_inbound'
import ChannelTransformer from '#transformers/channel_transformer'
import { inboundValidator } from '#validators/inbox'
import type { HttpContext } from '@adonisjs/core/http'

export default class InboxChannelsController {
  async index({ serialize }: HttpContext) {
    const channels = await Channel.query().preload('defaultQueue').orderBy('id')

    return serialize(ChannelTransformer.transform(channels))
  }

  async inbound({ params, request, response }: HttpContext) {
    const channel = await Channel.findOrFail(params.id)
    const { from, name, text } = await request.validateUsing(inboundValidator)
    const receipt = await writeIn(channel, { from, name, text })

    if (receipt !== 'accepted') return response.unprocessableEntity({ reason: receipt })

    // With tasks.inline() the ingest ran before `ingest` returned. A queued driver leaves it to
    // the worker, and the ticket may not exist yet.
    const ticket = await Ticket.query()
      .whereNotNull('openConversationId')
      .whereHas('conversation', conversation =>
        conversation
          .where('channelId', channel.id)
          .whereHas('contact', contact => contact.where('address', from)),
      )
      .first()

    return response.accepted({ receipt, ticketId: ticket === null ? null : ticket.id })
  }
}
