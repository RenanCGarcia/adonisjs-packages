import type { DateTime } from 'luxon'

import type { RejectionCode } from '../adapters/port.ts'
import { toContent, type ContentColumns } from '../message/content.ts'
import type {
  AttendantId,
  ConversationId,
  MessageContent,
  MessageId,
  MessageKind,
  MessageStatus,
  TicketId,
} from '../types.ts'
import type { InboxModel, Model } from './model.ts'

export interface InboxMessageRow extends ContentColumns {
  id: MessageId
  conversationId: ConversationId
  ticketId: TicketId | null
  direction: 'inbound' | 'outbound'
  status: MessageStatus | null
  authorId: AttendantId | null
  externalId: string | null
  clientRef: string | null
  failureCode: RejectionCode | null
  sentAt: DateTime
  dispatchedAt: DateTime | null
  /**
   * The `kind` and `body` columns as the union the package takes.
   */
  readonly content: MessageContent
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
      declare kind: MessageKind
      declare body: string
      declare status: MessageStatus | null
      declare authorId: AttendantId | null
      declare externalId: string | null
      declare clientRef: string | null
      declare failureCode: RejectionCode | null
      declare sentAt: DateTime
      declare dispatchedAt: DateTime | null

      get content() {
        return toContent(this)
      }
    }

    return InboxMessage
  }

  // SAFETY: InboxMessage declares every InboxMessageRow member on top of M.
  return mixin as <M extends Model>(superclass: M) => InboxMessageModel<M>
}
