import type { DateTime } from 'luxon'

import { InboxError } from '../errors.ts'
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

/**
 * The columns of `inbox_tickets`, as model attributes. The table's CHECK constraints admit
 * exactly the rows `toRow` can produce, so `toSnapshot` never meets a row it can't parse.
 */
export interface TicketRow {
  id: TicketId
  conversationId: ConversationId
  /**
   * The conversation id while the ticket is open and null once closed. Its unique index keeps
   * one open ticket per conversation without a partial index, since NULLs never collide.
   */
  openConversationId: ConversationId | null
  queueId: QueueId
  assigneeId: AttendantId | null
  assigneeKind: AttendantRef['kind'] | null
  status: TicketStatus
  closeReason: CloseReason | null
  version: number
  botState: TicketSnapshot['botState']
  unreadCount: number
  openedAt: DateTime
  assignedAt: DateTime | null
  firstResponseAt: DateTime | null
  lastActivityAt: DateTime
  closedAt: DateTime | null
}

export function toRow(snapshot: Omit<TicketSnapshot, 'id'>): Omit<TicketRow, 'id'> {
  const { state } = snapshot
  const assignee = state.status === 'queued' ? null : state.assignee

  return {
    conversationId: snapshot.conversationId,
    openConversationId: state.status === 'closed' ? null : snapshot.conversationId,
    queueId: state.queueId,
    assigneeId: assignee?.id ?? null,
    assigneeKind: assignee?.kind ?? null,
    status: state.status,
    closeReason: state.status === 'closed' ? state.reason : null,
    version: snapshot.version,
    botState: snapshot.botState,
    unreadCount: snapshot.unreadCount,
    openedAt: snapshot.openedAt,
    assignedAt: snapshot.assignedAt,
    firstResponseAt: snapshot.firstResponseAt,
    lastActivityAt: snapshot.lastActivityAt,
    closedAt: snapshot.closedAt,
  }
}

export function toSnapshot(row: TicketRow): TicketSnapshot {
  return {
    id: row.id,
    conversationId: row.conversationId,
    version: row.version,
    state: toState(row),
    openedAt: row.openedAt,
    assignedAt: row.assignedAt,
    firstResponseAt: row.firstResponseAt,
    lastActivityAt: row.lastActivityAt,
    closedAt: row.closedAt,
    unreadCount: row.unreadCount,
    botState: row.botState,
  }
}

function toState(row: TicketRow): TicketState {
  const assignee =
    row.assigneeId === null || row.assigneeKind === null
      ? null
      : { kind: row.assigneeKind, id: row.assigneeId }

  switch (row.status) {
    case 'queued':
      return { status: 'queued', queueId: row.queueId }
    case 'in_progress':
      if (assignee === null) throw invalidRow(row)

      return { status: 'in_progress', queueId: row.queueId, assignee }
    case 'closed':
      if (row.closeReason === null) throw invalidRow(row)

      return { status: 'closed', queueId: row.queueId, assignee, reason: row.closeReason }
    default: {
      const unknownStatus: never = row.status

      throw invalidRow({ ...row, status: unknownStatus })
    }
  }
}

function invalidRow(row: TicketRow) {
  return new InboxError(
    'E_INBOX_INVALID_ROW',
    `inbox: ticket ${row.id} has status "${row.status}" with assignee ${row.assigneeId} and close reason ${row.closeReason}, which the migration's CHECK constraints forbid`,
  )
}
