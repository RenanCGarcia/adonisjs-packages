import { setTimeout as sleep } from 'node:timers/promises'

import type { ApplicationService } from '@adonisjs/core/types'
import { test } from '@japa/runner'

import { adapters } from '../src/adapters/main.ts'
import type { Bot, BotReply, BotTurn } from '../src/bots.ts'
import { defineConfig } from '../src/define_config.ts'
import type { Inbox } from '../src/inbox.ts'
import { channelIn, eventually, FakeChannelAdapter } from '../src/testing/main.ts'
import type { Actor, JsonValue, TicketId } from '../src/types.ts'
import { boot, migratePlayground, playgroundModels } from './helpers/app.ts'

const fake = new FakeChannelAdapter()

const SYSTEM: Actor = { kind: 'system', source: 'test' }

const silent: BotReply<JsonValue> = { kind: 'silent', state: null }

let script: (turn: BotTurn<JsonValue>) => Promise<BotReply<JsonValue>> = async () => silent

let debounceMs = 0

const turns: Array<{ trigger: string; texts: string[] }> = []

class ScriptedBot implements Bot<JsonValue> {
  get debounce() {
    return { milliseconds: debounceMs }
  }

  initialState() {
    return { step: 0 }
  }

  async turn(turn: BotTurn<JsonValue>) {
    turns.push({ trigger: turn.trigger, texts: turn.unanswered.map(({ content }) => content.text) })

    return script(turn)
  }
}

function reply(text: string, state: JsonValue = { step: 1 }): BotReply<JsonValue> {
  return { kind: 'reply', messages: [{ kind: 'text', text }], state }
}

test.group('bot turns', group => {
  let app: ApplicationService
  let inbox: Inbox

  group.setup(async () => {
    await migratePlayground()

    app = await boot(
      defineConfig({
        models: playgroundModels(),
        bots: { scripted: async () => ({ default: ScriptedBot }) },
        channels: { fake: adapters.fake(fake) },
      }),
    )
    inbox = await app.container.make('inbox')

    return () => app.terminate()
  })

  group.each.setup(() => {
    fake.reset()
    turns.length = 0
    debounceMs = 0
    script = async () => silent
  })

  async function ticketRow(id: TicketId) {
    const db = await app.container.make('lucid.db')

    return db.from('inbox_tickets').where('id', id).firstOrFail()
  }

  async function outbound(id: TicketId) {
    const db = await app.container.make('lucid.db')

    return db
      .from('inbox_messages')
      .where('ticket_id', id)
      .where('direction', 'outbound')
      .select('body', 'status', 'author_id')
  }

  const sent = () => fake.sends.map(({ message }) => message.content)

  async function handToBot(ticketId: TicketId) {
    const bot = await inbox.attendants.bot('scripted')
    const result = await inbox.tickets.apply(ticketId, { gesture: 'assign', to: bot.id }, SYSTEM)

    if (result.outcome !== 'changed') throw new Error(`the assign was ${result.outcome}`)

    return { bot, version: result.ticket.version }
  }

  test('a bot answers the waiting messages and hands the ticket back in one write', async ({
    assert,
  }) => {
    const channel = await channelIn(app)

    await channel.write('hello')

    const ticketId = await channel.openTicket()

    script = async ({ trigger, state }) =>
      trigger === 'assigned'
        ? { kind: 'silent', state }
        : {
            kind: 'reply',
            messages: [{ kind: 'text', text: 'A colleague will send it.' }],
            state: { step: 1 },
            handoff: { gesture: 'return', note: 'wants an invoice' },
          }

    const { bot } = await handToBot(ticketId)

    await channel.write('I need an invoice')

    const db = await app.container.make('lucid.db')

    const events = await db
      .from('inbox_ticket_events')
      .where('ticket_id', ticketId)
      .where('type', 'assignment_changed')
      .orderBy('id')
      .select('data', 'actor_kind', 'actor_id', 'note')

    assert.deepEqual(turns, [
      { trigger: 'assigned', texts: ['hello'] },
      { trigger: 'message', texts: ['hello', 'I need an invoice'] },
    ])
    assert.deepEqual(sent(), [{ kind: 'text', text: 'A colleague will send it.' }])
    assert.deepEqual(await outbound(ticketId), [
      { body: 'A colleague will send it.', status: 'sent', author_id: bot.id },
    ])
    assert.deepInclude(await ticketRow(ticketId), {
      status: 'queued',
      bot_state: JSON.stringify({ [bot.id]: { step: 1 } }),
    })
    assert.deepEqual(
      events.slice(1).map(event => ({ ...event, data: JSON.parse(event.data) })),
      [
        {
          data: {
            fact: 'assignment_changed',
            from: { kind: 'bot', id: bot.id },
            to: null,
            via: 'return',
          },
          actor_kind: 'bot',
          actor_id: bot.id,
          note: 'wants an invoice',
        },
      ],
    )
  })

  test('a turn carries the channel and the contact of its ticket', async ({ assert }) => {
    const channel = await channelIn(app)

    await channel.write('hello')

    const ticketId = await channel.openTicket()
    const db = await app.container.make('lucid.db')

    const conversation = await db
      .from('inbox_conversations')
      .where('channel_id', channel.channelId)
      .firstOrFail()

    const seen: Array<Pick<BotTurn<JsonValue>, 'channel' | 'contactId'>> = []

    script = async ({ channel: on, contactId, state }) => {
      seen.push({ channel: on, contactId })

      return { kind: 'silent', state }
    }

    await handToBot(ticketId)

    assert.deepEqual(seen, [
      { channel: { id: channel.channelId, provider: 'fake' }, contactId: conversation.contact_id },
    ])
  })

  test('a turn whose ticket a human assumed meanwhile is dropped', async ({ assert }) => {
    const channel = await channelIn(app)

    await channel.write('hello')

    const ticketId = await channel.openTicket()
    const human = await inbox.attendants.forUser(Math.floor(Math.random() * 1e9))

    await inbox.queues.addMember(channel.queueId, human)

    script = async ({ ticket }) => {
      await inbox.tickets.apply(ticket.id, { gesture: 'assume' }, human)

      return reply('Too late')
    }

    const { bot } = await handToBot(ticketId)
    const row = await ticketRow(ticketId)

    assert.lengthOf(turns, 1)
    assert.deepEqual(sent(), [])
    assert.deepEqual(await outbound(ticketId), [])
    assert.include(row, { status: 'in_progress', assignee_id: human.id })
    assert.notProperty(JSON.parse(row.bot_state), String(bot.id))
  })

  test('a message that arrives mid-turn runs the turn again with both, for one reply', async ({
    assert,
  }) => {
    const channel = await channelIn(app)

    await channel.write('hello')

    const ticketId = await channel.openTicket()
    let interrupted = false

    debounceMs = 50

    script = async ({ unanswered }) => {
      if (!interrupted) {
        interrupted = true
        await channel.write('one more thing')
      }

      return reply(`Answering ${unanswered.length}`)
    }

    await handToBot(ticketId)

    assert.deepEqual(turns, [
      { trigger: 'assigned', texts: ['hello'] },
      { trigger: 'assigned', texts: ['hello', 'one more thing'] },
    ])
    assert.deepEqual(sent(), [{ kind: 'text', text: 'Answering 2' }])

    // The second message's own turn, after its debounce, finds it answered.
    await sleep(debounceMs * 4)

    assert.lengthOf(turns, 2)
    assert.lengthOf(fake.sends, 1)
  })

  test('a turn that throws is retried, and a turn delivered again sends nothing', async ({
    assert,
  }) => {
    const channel = await channelIn(app)

    await channel.write('hello')

    const ticketId = await channel.openTicket()
    let calls = 0

    script = async () => {
      calls++

      if (calls === 1) throw new Error('the model is unavailable')

      return reply('Hi!')
    }

    const { bot, version } = await handToBot(ticketId)

    assert.lengthOf(fake.sends, 0)

    await eventually(() => fake.sends.length === 1)
    await inbox.run({
      task: 'bot_turn',
      ticketId,
      botId: bot.id,
      trigger: { kind: 'assigned', version },
      attempt: 1,
    })

    assert.equal(calls, 2)
    assert.deepEqual(sent(), [{ kind: 'text', text: 'Hi!' }])
    assert.lengthOf(await outbound(ticketId), 1)
  })
})
