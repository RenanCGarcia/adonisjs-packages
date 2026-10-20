import { randomUUID } from 'node:crypto'

import type { ApplicationService } from '@adonisjs/core/types'
import { test } from '@japa/runner'

import { adapters } from '../src/adapters/main.ts'
import { defineConfig, type AuthorizeQuestion } from '../src/define_config.ts'
import type { Inbox } from '../src/inbox.ts'
import type { Attendant, ConversationId, InboxEvents, QueueId } from '../src/types.ts'
import { boot, migratePlayground, playgroundBots, playgroundModels } from './helpers/app.ts'

/**
 * Called by `authorize`, after the ticket was read and before it is written, which is where a
 * concurrent writer gets in.
 */
let meanwhile: (question: AuthorizeQuestion) => Promise<void> = async () => {}

const playgroundConfig = () =>
  defineConfig({
    models: playgroundModels(),
    bots: playgroundBots(),
    channels: { fake: adapters.fake() },
    authorize: async question => {
      await meanwhile(question)

      return true
    },
  })

test.group('ticket writes', group => {
  let app: ApplicationService
  let inbox: Inbox

  group.setup(async () => {
    await migratePlayground()
    app = await boot(playgroundConfig())
    inbox = await app.container.make('inbox')

    return () => app.terminate()
  })

  group.each.teardown(() => {
    meanwhile = async () => {}
  })

  /**
   * The queue, channel, contact and conversation are the host's rows, so they are inserted as
   * they are. The memberships and the ticket go through the inbox.
   */
  async function ticketIn(...members: Attendant[]) {
    const db = await app.container.make('lucid.db')
    const now = '2026-01-05 10:00:00'
    const [queueId] = await db.table('inbox_queues').insert({ name: 'support', created_at: now })

    const [channelId] = await db.table('inbox_channels').insert({
      provider: 'fake',
      name: 'test',
      default_queue_id: queueId,
      webhook_token: randomUUID(),
      credentials: '{}',
      created_at: now,
    })

    const [contactId] = await db
      .table('inbox_contacts')
      .insert({ channel_id: channelId, address: randomUUID(), created_at: now })

    const [conversationId] = await db
      .table('inbox_conversations')
      .insert({ channel_id: channelId, contact_id: contactId, created_at: now })

    // SAFETY: the id the queue insert above returned.
    const queue = queueId as QueueId

    for (const member of members) await inbox.queues.addMember(queue, member)

    // SAFETY: the id the conversation insert above returned.
    const conversation = conversationId as ConversationId

    const { ticket } = await inbox.tickets.open(conversation, queue, {
      kind: 'system',
      source: 'test',
    })

    return ticket
  }

  const human = () => inbox.attendants.forUser(Math.floor(Math.random() * 1e9))

  test('an assume that loses the race reads again and finds the ticket taken', async ({
    assert,
  }) => {
    const ana = await human()
    const bea = await human()
    const ticket = await ticketIn(ana, bea)
    const asked: string[] = []

    meanwhile = async ({ actor }) => {
      asked.push(actor.kind === 'system' ? actor.source : String(actor.id))

      if (asked.length === 1) await inbox.tickets.apply(ticket.id, { gesture: 'assume' }, bea)
    }

    const result = await inbox.tickets.apply(ticket.id, { gesture: 'assume' }, ana)

    assert.deepEqual(result, { outcome: 'rejected', reason: 'held_by_other' })
    assert.deepEqual(asked, [String(ana.id), String(bea.id), String(ana.id)])
  })

  test('a write that keeps losing gives up with conflict and writes nothing', async ({
    assert,
  }) => {
    const ana = await human()
    const ticket = await ticketIn(ana)
    const db = await app.container.make('lucid.db')
    let attempts = 0

    meanwhile = async () => {
      attempts++
      await db.from('inbox_tickets').where('id', ticket.id).increment('version', 1)
    }

    const result = await inbox.tickets.apply(ticket.id, { gesture: 'assume' }, ana)
    const events = await db.from('inbox_ticket_events').where('ticket_id', ticket.id)

    assert.deepEqual(result, { outcome: 'rejected', reason: 'conflict' })
    assert.equal(attempts, 3)
    assert.deepEqual(
      events.map(event => event.type),
      ['opened'],
    )
  })

  test('a membership removed before the write lands rejects the assume', async ({ assert }) => {
    const ana = await human()
    const ticket = await ticketIn(ana)
    const db = await app.container.make('lucid.db')
    let removed = false

    meanwhile = async () => {
      if (removed) return

      removed = true
      await db.from('inbox_queue_members').where('attendant_id', ana.id).delete()
    }

    const result = await inbox.tickets.apply(ticket.id, { gesture: 'assume' }, ana)

    assert.deepEqual(result, { outcome: 'rejected', reason: 'not_member' })
  })

  test('ticket_changed is emitted once, after the write committed', async ({ assert }) => {
    const ana = await human()
    const ticket = await ticketIn(ana)
    const emitter = await app.container.make('emitter')
    const db = await app.container.make('lucid.db')

    const seen: Array<{ change: InboxEvents['inbox:ticket_changed']['change']; status: string }> =
      []

    emitter.on('inbox:ticket_changed', async payload => {
      if (payload.ticketId !== ticket.id) return

      const row = await db.from('inbox_tickets').where('id', ticket.id).firstOrFail()

      seen.push({ change: payload.change, status: row.status })
    })

    await inbox.tickets.apply(ticket.id, { gesture: 'assume' }, ana)
    await inbox.tickets.apply(ticket.id, { gesture: 'assume' }, ana)

    assert.deepEqual(seen, [{ change: 'assume', status: 'in_progress' }])
  })

  test('a bot key outside config.bots is a programmer error', async ({ assert }) => {
    await assert.rejects(() => inbox.attendants.bot('nope'), /"nope" is not in config.bots/)
  })
})

test.group('inbox provider', () => {
  test('a config that leaves a model role out fails the boot', async ({ assert }) => {
    const { ticket, ...models } = playgroundModels()

    // @ts-expect-error a JavaScript config can leave a role out, which only the boot catches.
    const config = defineConfig({ models, bots: {}, channels: {} })

    assert.exists(ticket)
    await assert.rejects(() => boot(config), /config.models is missing ticket/)
  })
})
