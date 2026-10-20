import {
  adapters,
  automations,
  defineConfig,
  tasks,
  type InferBots,
} from '@enzopita/adonisjs-inbox'

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
   * The bot attendants by key, each a class implementing Bot, such as
   * triage: () => import('#bots/triage_bot')
   */
  bots: {
    triage: () => import('#bots/triage_bot'),
    flows: () => import('@enzopita/adonisjs-inbox-flows/bot'),
  },

  /**
   * Run in order when a ticket opens, a message arrives or node ace inbox:tick runs, such as
   * automations.closeInactive({ after: { hours: 48 } })
   */
  automations: [
    // Contacts writing in on a triage channel start with the triage bot.
    automations.assignOnOpen({
      bot: 'triage',
      when: ({ channel }) => channel.provider === 'triage',
    }),
    // On a flows channel, the flows bot picks the flow from the bindings in config/inbox_flows.ts.
    automations.assignOnOpen({
      bot: 'flows',
      when: ({ channel }) => channel.provider === 'flows',
    }),
    automations.closeInactive({ after: { hours: 48 } }),
  ],

  /**
   * One adapter per provider, keyed by the provider column of your channels.
   */
  channels: {
    fake: adapters.fake(),
    triage: adapters.fake(),
    flows: adapters.fake(),
  },

  /**
   * Where webhooks are ingested, messages dispatched and bot turns run after each commit. Use
   * tasks.queue() with an @adonisjs/queue job in production.
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
