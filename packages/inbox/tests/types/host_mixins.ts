/**
 * Type-checked on its own by `tsc -p tests/types`, because it augments `InboxBots` the way a host's
 * config file does, which would narrow the bot keys of every other spec.
 */
import { compose } from '@adonisjs/core/helpers'
import type { NormalizeConstructor } from '@adonisjs/core/types/helpers'
import { BaseModel, beforeCreate, beforeFind, column } from '@adonisjs/lucid/orm'
import type { LucidModel, ModelQueryBuilderContract } from '@adonisjs/lucid/types/model'

import { defineConfig, type InferBots } from '../../index.ts'
import {
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
} from '../../src/mixins/main.ts'
import type { Bot } from '../../src/bots.ts'
import type { Attendant as AttendantRef, TicketState } from '../../src/types.ts'

/**
 * A host mixin with a column, a create hook and a query hook, composed after the inbox's.
 */
function withAccount() {
  return <M extends NormalizeConstructor<typeof BaseModel>>(superclass: M) => {
    class Owned extends superclass {
      @column()
      declare accountId: number

      @beforeCreate()
      static stamp(row: Owned) {
        row.accountId ??= 1
      }

      @beforeFind()
      static scope(query: ModelQueryBuilderContract<LucidModel>) {
        query.where('account_id', 1)
      }
    }

    return Owned
  }
}

class Schema extends BaseModel {}

class Attendant extends compose(Schema, withInboxAttendant(), withAccount()) {}

class Channel extends compose(Schema, withInboxChannel(), withAccount()) {}

class ChannelEvent extends compose(Schema, withInboxChannelEvent(), withAccount()) {}

class Contact extends compose(Schema, withInboxContact(), withAccount()) {}

class Conversation extends compose(Schema, withInboxConversation(), withAccount()) {}

class Message extends compose(Schema, withInboxMessage(), withAccount()) {}

class Queue extends compose(Schema, withInboxQueue(), withAccount()) {}

class QueueMember extends compose(Schema, withInboxQueueMember(), withAccount()) {}

class Ticket extends compose(Schema, withInboxTicket(), withAccount()) {}

class TicketEvent extends compose(Schema, withInboxTicketEvent(), withAccount()) {}

declare const helper: () => Promise<{ default: new () => Bot<null> }>

const config = defineConfig({
  models: {
    attendant: async () => ({ default: Attendant }),
    channel: async () => ({ default: Channel }),
    channelEvent: async () => ({ default: ChannelEvent }),
    contact: async () => ({ default: Contact }),
    conversation: async () => ({ default: Conversation }),
    message: async () => ({ default: Message }),
    queue: async () => ({ default: Queue }),
    queueMember: async () => ({ default: QueueMember }),
    ticket: async () => ({ default: Ticket }),
    ticketEvent: async () => ({ default: TicketEvent }),
  },
  bots: { helper },
  channels: {},
  ownership: channel => ({ accountId: channel.accountId }),
})

declare module '../../src/types.ts' {
  interface InboxBots extends InferBots<typeof config> {}
}

declare const ticket: Ticket
declare const attendant: Attendant

export const state: TicketState = ticket.state
export const version: number = ticket.snapshot.version
export const account: number = ticket.accountId
export const role: 'ticket' = Ticket.inboxRole
export const asAttendant: AttendantRef = attendant.asAttendant
export const found: Promise<Ticket | null> = Ticket.find(1)
