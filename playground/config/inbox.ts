import { adapters, defineConfig, tasks, type InferBots } from '@enzopita/adonisjs-inbox'

const inboxConfig = defineConfig({
  models: {
    attendant: () => import('#models/inbox/attendant'),
    channel: () => import('#models/inbox/channel'),
    channelEvent: () => import('#models/inbox/channel_event'),
    contact: () => import('#models/inbox/contact'),
    conversation: () => import('#models/inbox/conversation'),
    message: () => import('#models/inbox/message'),
    queue: () => import('#models/inbox/queue'),
    queueMember: () => import('#models/inbox/queue_member'),
    ticket: () => import('#models/inbox/ticket'),
    ticketEvent: () => import('#models/inbox/ticket_event'),
  },

  /**
   * Keys of the bot attendants, the only ones inbox.attendants.bot(key) accepts.
   */
  bots: ['triage'],

  /**
   * One adapter per provider, keyed by the provider column of your channels.
   */
  channels: {
    fake: adapters.fake(),
  },

  /**
   * Where webhooks are ingested and messages dispatched after each commit. Use tasks.queue()
   * with an @adonisjs/queue job in production.
   */
  tasks: tasks.inline(),

  // A human can't close a ticket a colleague holds.
  authorize: ({ actor, operation, ticket }) =>
    operation.gesture !== 'close' ||
    actor.kind !== 'human' ||
    ticket.state.status !== 'in_progress' ||
    ticket.state.assignee.id === actor.id,
})

export default inboxConfig

declare module '@enzopita/adonisjs-inbox/types' {
  interface InboxBots extends InferBots<typeof inboxConfig> {}
}
