import { column } from '@adonisjs/lucid/orm'
import type { DateTime } from 'luxon'

import { toSnapshot, type TicketRow } from '../ticket/row.ts'
import type {
  AttendantId,
  AttendantRef,
  CloseReason,
  ConversationId,
  QueueId,
  TicketId,
  TicketSnapshot,
  TicketState,
  TicketStatus,
} from '../types.ts'
import { jsonText, type InboxModel, type Model } from './model.ts'

export interface InboxTicketRow extends TicketRow {
  readonly snapshot: TicketSnapshot
  readonly state: TicketState
}

export type InboxTicketModel<M extends Model = Model> = InboxModel<'ticket', InboxTicketRow, M>

export function withInboxTicket(): <M extends Model>(superclass: M) => InboxTicketModel<M> {
  const mixin = (superclass: Model) => {
    class InboxTicket extends superclass {
      static readonly inboxRole = 'ticket'

      declare id: TicketId
      declare conversationId: ConversationId
      declare openConversationId: ConversationId | null
      declare queueId: QueueId
      declare assigneeId: AttendantId | null
      declare assigneeKind: AttendantRef['kind'] | null
      declare status: TicketStatus
      declare closeReason: CloseReason | null
      declare version: number
      declare unreadCount: number
      declare openedAt: DateTime
      declare assignedAt: DateTime | null
      declare firstResponseAt: DateTime | null
      declare lastActivityAt: DateTime
      declare closedAt: DateTime | null

      @column(jsonText<TicketRow['botState']>())
      declare botState: TicketRow['botState']

      get snapshot() {
        return toSnapshot(this)
      }

      get state() {
        return this.snapshot.state
      }
    }

    return InboxTicket
  }

  // SAFETY: InboxTicket declares every InboxTicketRow member and the role tag on top of M.
  return mixin as <M extends Model>(superclass: M) => InboxTicketModel<M>
}
