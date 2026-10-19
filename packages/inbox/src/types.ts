import type { DateTime } from 'luxon'

declare const brand: unique symbol

type Brand<T, B extends string> = T & { readonly [brand]: B }

export type TicketId = Brand<number, 'TicketId'>

export type ConversationId = Brand<number, 'ConversationId'>

export type ChannelId = Brand<number, 'ChannelId'>

export type ContactId = Brand<number, 'ContactId'>

export type MessageId = Brand<number, 'MessageId'>

export type QueueId = Brand<number, 'QueueId'>

export type AttendantId = Brand<number, 'AttendantId'>

export type ChannelEventId = Brand<number, 'ChannelEventId'>

/**
 * The host's user primary key. The package never loads the user.
 */
export type HostUserId = number | string

/**
 * Augmented from `config/inbox.ts`, so a bot key outside the config fails to compile.
 */
export interface InboxBots {}

export type BotKey = keyof InboxBots extends never ? string : Extract<keyof InboxBots, string>

/**
 * Augmented by the host to add its own close reasons, such as `opted_out: true`.
 */
export interface InboxCloseReasons {
  manual: true
  inactivity: true
  bot_completed: true
  channel_removed: true
}

export type CloseReason = Extract<keyof InboxCloseReasons, string>

export type JsonValue =
  | string
  | number
  | boolean
  | null
  | JsonValue[]
  | { [key: string]: JsonValue }

/**
 * One row of `inbox_attendants`. The table's CHECK constraint makes the flat row and this union
 * equivalent, so parsing a stored row never fails.
 */
export type Attendant =
  | { kind: 'human'; id: AttendantId; userId: HostUserId; active: boolean }
  | { kind: 'bot'; id: AttendantId; botKey: BotKey; active: boolean }

export type AttendantRef = { kind: Attendant['kind']; id: AttendantId }

/**
 * `system` covers automations and housekeeping, and names its source so ticket events say which
 * automation acted.
 */
export type Actor = Attendant | { kind: 'system'; source: string }

/**
 * A closed ticket keeps whoever held it, for handling-time metrics.
 */
export type TicketState =
  | { status: 'queued'; queueId: QueueId }
  | { status: 'in_progress'; queueId: QueueId; assignee: AttendantRef }
  | { status: 'closed'; queueId: QueueId; assignee: AttendantRef | null; reason: CloseReason }

export type TicketStatus = TicketState['status']

export interface TicketSnapshot {
  id: TicketId
  conversationId: ConversationId
  version: number
  state: TicketState
  openedAt: DateTime
  assignedAt: DateTime | null
  firstResponseAt: DateTime | null
  lastActivityAt: DateTime
  closedAt: DateTime | null
  unreadCount: number
  /**
   * Keyed by the bot attendant's id, so two bots never clobber each other and a bot that gets
   * the ticket back resumes where it left off.
   */
  botState: Partial<Record<AttendantId, JsonValue>>
}

export type Gesture =
  | { gesture: 'assume'; note?: string }
  | { gesture: 'assign'; to: AttendantId; note?: string }
  | { gesture: 'transfer'; queueId: QueueId; to?: AttendantId; note?: string }
  | { gesture: 'return'; note?: string }
  | { gesture: 'close'; reason: CloseReason; note?: string }

export type GestureName = Gesture['gesture']

/**
 * Append-only rows of `inbox_ticket_events`. Metrics read these, never the ticket row.
 */
export type TicketFact =
  | { fact: 'opened'; queueId: QueueId; origin: 'inbound' | 'outbound' }
  | { fact: 'queue_changed'; from: QueueId; to: QueueId }
  | {
      fact: 'assignment_changed'
      from: AttendantRef | null
      to: AttendantRef | null
      via: GestureName | 'reply'
    }
  | { fact: 'closed'; reason: CloseReason }

export type Rejection =
  | 'closed'
  | 'already_closed'
  | 'held_by_other'
  | 'not_assignee'
  | 'not_member'
  | 'attendant_inactive'
  | 'actor_cannot_hold'
  | 'forbidden'
  | 'conflict'

export type ApplyResult =
  | { outcome: 'changed'; ticket: TicketSnapshot; facts: TicketFact[] }
  | { outcome: 'unchanged'; ticket: TicketSnapshot }
  | { outcome: 'rejected'; reason: Rejection }

export type MessageStatus = 'pending' | 'sent' | 'delivered' | 'read' | 'played' | 'failed'

export interface OutgoingText {
  text: string
}

export interface SendMessageOptions {
  /**
   * The client's idempotency key. A second send with it returns the message the first stored.
   */
  clientRef?: string
}

export type SendOutcome =
  | { outcome: 'queued'; messageId: MessageId; ticket: TicketSnapshot }
  | { outcome: 'rejected'; reason: Rejection }

export type IngestReceipt = 'accepted' | 'unknown_channel' | 'invalid_signature'

/**
 * Augmented into the `EventsList` of `@adonisjs/core/types` by the provider.
 */
export interface InboxEvents {
  'inbox:ticket_opened': { ticketId: TicketId; conversationId: ConversationId; queueId: QueueId }
  'inbox:ticket_changed': {
    ticketId: TicketId
    change: GestureName | 'reply'
    from: TicketState
    to: TicketState
    facts: TicketFact[]
  }
  'inbox:message_received': {
    messageId: MessageId
    ticketId: TicketId
    conversationId: ConversationId
  }
  'inbox:message_status_changed': { messageId: MessageId; status: MessageStatus }
}
