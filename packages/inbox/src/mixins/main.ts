import type { ModelRole } from '../models.ts'
import { withInboxAttendant } from './attendant.ts'
import { withInboxChannel } from './channel.ts'
import { withInboxChannelEvent } from './channel_event.ts'
import { withInboxContact } from './contact.ts'
import { withInboxConversation } from './conversation.ts'
import { withInboxMessage } from './message.ts'
import type { Model } from './model.ts'
import { withInboxQueue } from './queue.ts'
import { withInboxQueueMember } from './queue_member.ts'
import { withInboxTicket } from './ticket.ts'
import { withInboxTicketEvent } from './ticket_event.ts'

export {
  withInboxAttendant,
  withInboxChannel,
  withInboxChannelEvent,
  withInboxContact,
  withInboxConversation,
  withInboxMessage,
  withInboxQueue,
  withInboxQueueMember,
  withInboxTicket,
  withInboxTicketEvent,
}

import type { InboxAttendantModel } from './attendant.ts'
import type { InboxChannelModel } from './channel.ts'
import type { InboxChannelEventModel } from './channel_event.ts'
import type { InboxContactModel } from './contact.ts'
import type { InboxConversationModel } from './conversation.ts'
import type { InboxMessageModel } from './message.ts'
import type { InboxQueueModel } from './queue.ts'
import type { InboxQueueMemberModel } from './queue_member.ts'
import type { InboxTicketModel } from './ticket.ts'
import type { InboxTicketEventModel } from './ticket_event.ts'

export type { InboxAttendantModel, InboxAttendantRow } from './attendant.ts'

export type { InboxChannelModel, InboxChannelRow } from './channel.ts'

export type { InboxChannelEventModel, InboxChannelEventRow } from './channel_event.ts'

export type { InboxContactModel, InboxContactRow } from './contact.ts'

export type { InboxConversationModel, InboxConversationRow } from './conversation.ts'

export type { InboxMessageModel, InboxMessageRow } from './message.ts'

export type { InboxModel } from './model.ts'

export type { InboxQueueModel, InboxQueueRow } from './queue.ts'

export type { InboxQueueMemberModel, InboxQueueMemberRow } from './queue_member.ts'

export type { InboxTicketModel, InboxTicketRow } from './ticket.ts'

export type { InboxTicketEventModel, InboxTicketEventRow } from './ticket_event.ts'

/**
 * The mixin each model role needs, checked to cover every role and to tag each with its own.
 */
export const INBOX_MIXINS = {
  attendant: withInboxAttendant,
  channel: withInboxChannel,
  channelEvent: withInboxChannelEvent,
  contact: withInboxContact,
  conversation: withInboxConversation,
  message: withInboxMessage,
  queue: withInboxQueue,
  queueMember: withInboxQueueMember,
  ticket: withInboxTicket,
  ticketEvent: withInboxTicketEvent,
} satisfies { [R in ModelRole]: () => (superclass: Model) => { readonly inboxRole: R } }

/**
 * The model type each role's mixin produces. `defineConfig` types every `models` slot with it.
 */
export interface InboxModelsByRole {
  attendant: InboxAttendantModel
  channel: InboxChannelModel
  channelEvent: InboxChannelEventModel
  contact: InboxContactModel
  conversation: InboxConversationModel
  message: InboxMessageModel
  queue: InboxQueueModel
  queueMember: InboxQueueMemberModel
  ticket: InboxTicketModel
  ticketEvent: InboxTicketEventModel
}

export type InboxModelOf<R extends ModelRole> = InboxModelsByRole[R]
