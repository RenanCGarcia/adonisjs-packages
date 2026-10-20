import type Ticket from '#models/inbox/ticket'
import { BaseTransformer } from '@adonisjs/core/transformers'

/**
 * Reads `queue`, `assignee.user`, `conversation.contact`, `conversation.channel` and the last
 * of `messages` with its `author.user`, and in the detail `conversation.messages.author.user`
 * and `events.actor.user`.
 */
export default class TicketTransformer extends BaseTransformer<Ticket> {
  toObject() {
    const { state, queue, assignee, conversation } = this.resource
    const { contact, channel } = conversation
    const last = this.resource.messages.at(0)

    return {
      ...this.pick(this.resource, [
        'id',
        'version',
        'unreadCount',
        'openedAt',
        'lastActivityAt',
        'closedAt',
      ]),
      status: state.status,
      closeReason: state.status === 'closed' ? state.reason : null,
      queue: { id: queue.id, name: queue.name },
      assignee: assignee === null ? null : assignee.ref,
      contact: { id: contact.id, name: contact.name, address: contact.address },
      channel: { id: channel.id, name: channel.name, provider: channel.provider },
      lastMessage:
        last === undefined
          ? null
          : {
              direction: last.direction,
              text: last.content.text,
              sentAt: last.sentAt,
              author: last.author === null ? null : last.author.ref,
            },
    }
  }

  forDetail() {
    return {
      ...this.toObject(),
      messages: this.resource.conversation.messages.map(message => ({
        ...this.pick(message, ['id', 'ticketId', 'direction', 'status', 'failureCode', 'sentAt']),
        text: message.content.text,
        author: message.author === null ? null : message.author.ref,
      })),
      events: this.resource.events.map(event => ({
        ...this.pick(event, ['id', 'type', 'data', 'note', 'createdAt']),
        actor:
          event.actor === null
            ? { id: null, kind: event.actorKind, name: event.actorSource ?? event.actorKind }
            : event.actor.ref,
      })),
    }
  }
}
