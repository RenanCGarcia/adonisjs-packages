import type { ApplicationService } from '@adonisjs/core/types'
import { test } from '@japa/runner'
import { DateTime } from 'luxon'

import { adapters } from '../src/adapters/main.ts'
import { automations, defineAutomation, type TicketMoment } from '../src/automations.ts'
import type { Bot, BotTurn } from '../src/bots.ts'
import { defineConfig } from '../src/define_config.ts'
import type { Inbox } from '../src/inbox.ts'
import { FakeChannelAdapter } from '../src/testing/main.ts'
import type { JsonValue, TicketId } from '../src/types.ts'
import { boot, migratePlayground, playgroundModels } from './helpers/app.ts'
import { channelIn } from './helpers/channel.ts'

const fake = new FakeChannelAdapter()

const turns: string[][] = []

const decisions: string[] = []

class GreeterBot implements Bot<JsonValue> {
  initialState() {
    return null
  }

  async turn({ unanswered }: BotTurn<JsonValue>) {
    turns.push(unanswered.map(({ content }) => content.text))

    return {
      kind: 'reply' as const,
      messages: [{ kind: 'text' as const, text: 'Hi, I am the bot.' }],
      state: null,
    }
  }
}

const on =
  (provider: string) =>
  ({ channel }: TicketMoment) =>
    channel.provider === provider

test.group('automations', group => {
  let app: ApplicationService
  let inbox: Inbox

  group.setup(async () => {
    await migratePlayground()

    const channels = Object.fromEntries(
      ['assign', 'night', 'greet', 'loop', 'idle'].map(provider => [provider, adapters.fake(fake)]),
    )

    app = await boot(
      defineConfig({
        models: playgroundModels(),
        bots: { greeter: async () => ({ default: GreeterBot }) },
        channels,
        automations: [
          automations.assignOnOpen({ bot: 'greeter', when: on('assign') }),
          automations.assignQueuedOnMessage({ bot: 'greeter', when: on('night') }),
          automations.autoReply({ text: 'Thanks for writing!', when: on('greet') }),
          automations.closeInactive({ after: { hours: 48 } }),
          defineAutomation({
            name: 'assign_loop',
            on: 'ticket_opened',
            decide: moment => {
              if (!on('loop')(moment)) return []

              decisions.push('opened')

              return [{ effect: 'assign_bot', bot: 'greeter' }]
            },
          }),
          defineAutomation({
            name: 'acknowledge',
            on: 'message_received',
            decide: moment => {
              if (!on('loop')(moment)) return []

              decisions.push('received')

              return [{ effect: 'send', content: { kind: 'text', text: 'Got it.' } }]
            },
          }),
        ],
      }),
    )
    inbox = await app.container.make('inbox')

    return () => app.terminate()
  })

  group.each.setup(() => {
    fake.reset()
    turns.length = 0
    decisions.length = 0
  })

  async function ticketRow(id: TicketId) {
    const db = await app.container.make('lucid.db')

    return db.from('inbox_tickets').where('id', id).firstOrFail()
  }

  const sent = () => fake.sends.map(({ message }) => message.content)

  test('assignOnOpen opens the ticket already with the bot, which answers the first message', async ({
    assert,
  }) => {
    const db = await app.container.make('lucid.db')
    const emitter = await app.container.make('emitter')
    const bot = await inbox.attendants.bot('greeter')
    const channel = await channelIn(app, 'assign')
    const atOpen: string[] = []

    const listener = async ({ ticketId }: { ticketId: TicketId }) => {
      atOpen.push((await ticketRow(ticketId)).status)
    }

    emitter.on('inbox:ticket_opened', listener)

    try {
      await channel.write('hello')
    } finally {
      emitter.off('inbox:ticket_opened', listener)
    }

    const ticketId = await channel.openTicket()

    const events = await db
      .from('inbox_ticket_events')
      .where('ticket_id', ticketId)
      .orderBy('id')
      .select('type', 'actor_source')

    assert.deepEqual(atOpen, ['in_progress'])
    assert.include(await ticketRow(ticketId), { status: 'in_progress', assignee_id: bot.id })
    assert.deepEqual(events, [
      { type: 'opened', actor_source: 'ingest' },
      { type: 'assignment_changed', actor_source: 'assign_on_open' },
    ])
    assert.deepEqual(turns, [['hello']])
    assert.deepEqual(sent(), [{ kind: 'text', text: 'Hi, I am the bot.' }])
  })

  test('assignQueuedOnMessage hands a queued ticket to the bot when a message arrives', async ({
    assert,
  }) => {
    const bot = await inbox.attendants.bot('greeter')
    const channel = await channelIn(app, 'night')

    await channel.write('anyone there?')

    assert.include(await ticketRow(await channel.openTicket()), { assignee_id: bot.id })
    assert.deepEqual(turns, [['anyone there?']])
  })

  test('autoReply sends once per opening', async ({ assert }) => {
    const channel = await channelIn(app, 'greet')

    await channel.write('hello')
    await channel.write('are you there?')

    const first = await channel.openTicket()

    await inbox.tickets.apply(
      first,
      { gesture: 'close', reason: 'manual' },
      { kind: 'system', source: 'test' },
    )
    await channel.write('me again')

    const greeting = { kind: 'text', text: 'Thanks for writing!' }

    assert.notEqual(await channel.openTicket(), first)
    assert.deepEqual(sent(), [greeting, greeting])
  })

  test('effects never trigger automations again', async ({ assert }) => {
    const channel = await channelIn(app, 'loop')

    await channel.write('hello')
    await channel.write('still there?')

    assert.deepEqual(decisions, ['opened', 'received', 'received'])
    assert.deepEqual(turns, [['hello'], ['still there?']])
    assert.deepEqual(
      sent().map(content => content.text),
      ['Got it.', 'Hi, I am the bot.', 'Got it.', 'Hi, I am the bot.'],
    )
  })

  test('closeInactive closes only stale tickets, and a second tick changes nothing', async ({
    assert,
  }) => {
    const db = await app.container.make('lucid.db')
    const stale = await channelIn(app, 'idle')
    const fresh = await channelIn(app, 'idle')

    await stale.write('hello')
    await fresh.write('hello')

    const staleId = await stale.openTicket()
    const freshId = await fresh.openTicket()

    await db
      .from('inbox_tickets')
      .where('id', staleId)
      .update({
        last_activity_at: DateTime.now()
          .minus({ days: 3 })
          .toFormat(db.connection().dialect.dateTimeFormat),
      })

    const first = await inbox.tick()
    const second = await inbox.tick()

    assert.include(await ticketRow(staleId), { status: 'closed', close_reason: 'inactivity' })
    assert.include(await ticketRow(freshId), { status: 'queued' })
    assert.isAtLeast(first.automations.close_inactive?.changed ?? 0, 1)
    assert.deepEqual(second.automations.close_inactive, { candidates: 0, changed: 0 })
  })
})
