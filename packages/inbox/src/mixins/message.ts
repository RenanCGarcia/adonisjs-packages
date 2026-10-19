import type { DateTime } from 'luxon'

import type { AttendantId, ConversationId, MessageId, MessageStatus, TicketId } from '../types.ts'
import type { InboxModel, Model } from './model.ts'

export interface InboxMessageRow {
  id: MessageId
  conversationId: ConversationId
  ticketId: TicketId | null
  direction: 'inbound' | 'outbound'
  body: string
  status: MessageStatus | null
  authorId: AttendantId | null
  externalId: string | null
  clientRef: string | null
  sentAt: DateTime
  dispatchedAt: DateTime | null
}

export type InboxMessageModel<M extends Model = Model> = InboxModel<'message', InboxMessageRow, M>

export function withInboxMessage(): <M extends Model>(superclass: M) => InboxMessageModel<M> {
  const mixin = (superclass: Model) => {
    class InboxMessage extends superclass {
      static readonly inboxRole = 'message'

      declare id: MessageId
      declare conversationId: ConversationId
      declare ticketId: TicketId | null
      declare direction: 'inbound' | 'outbound'
      declare body: string
      declare status: MessageStatus | null
      declare authorId: AttendantId | null
      declare externalId: string | null
      declare clientRef: string | null
      declare sentAt: DateTime
      declare dispatchedAt: DateTime | null
    }

    return InboxMessage
  }

  // SAFETY: InboxMessage only narrows the types of columns M already has at runtime.
  return mixin as <M extends Model>(superclass: M) => InboxMessageModel<M>
}
