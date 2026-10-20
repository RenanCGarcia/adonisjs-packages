import { randomUUID } from 'node:crypto'

import type { ApplicationService } from '@adonisjs/core/types'
import { test } from '@japa/runner'
import { DateTime } from 'luxon'

import { adapters } from '../src/adapters/main.ts'
import { defineConfig } from '../src/define_config.ts'
import type { Inbox } from '../src/inbox.ts'
import { tasks } from '../src/tasks.ts'
import { FakeChannelAdapter, fakeWebhookBody } from '../src/testing/main.ts'
import type { MessageId, QueueId, TicketId } from '../src/types.ts'
import { boot, migratePlayground, playgroundModels } from './helpers/app.ts'

const fake = new FakeChannelAdapter()

test.group('outbox', group => {
  let app: ApplicationService
  let inbox: Inbox

  group.setup(async () => {
    await migratePlayground()

    app = await boot(
      defineConfig({
        models: playgroundModels(),
        bots: [],
        channels: { fake: adapters.fake(fake) },
        tasks: tasks.inline(),
      }),
    )
    inbox = await app.container.make('inbox')

    return () => app.terminate()
  })

  group.each.setup(() => fake.reset())

  /**
   * A contact writes in through the real webhook entry, and an agent of the channel's queue
   * replies to the ticket that opened.
   */
  async function inboundTicket() {
    const db = await app.container.make('lucid.db')
    const now = '2026-01-05 10:00:00'
    const token = randomUUID()
    const [queueId] = await db.table('inbox_queues').insert({ name: 'support', created_at: now })

    await db.table('inbox_channels').insert({
      provider: 'fake',
      name: 'test',
      default_queue_id: queueId,
      webhook_token: token,
      credentials: JSON.stringify({ secret: 's3cret' }),
      created_at: now,
    })

    const address = `+55${randomUUID()}`

    const receipt = await inbox.ingest(token, {
      headers: { 'x-fake-secret': 's3cret' },
      rawBody: fakeWebhookBody({
        type: 'message_received',
        externalId: randomUUID(),
        from: { address },
        text: 'hello',
        sentAt: DateTime.now(),
      }),
    })

    const ticket = await db
      .from('inbox_tickets')
      .join('inbox_conversations', 'inbox_conversations.id', 'inbox_tickets.conversation_id')
      .join('inbox_channels', 'inbox_channels.id', 'inbox_conversations.channel_id')
      .where('inbox_channels.webhook_token', token)
      .select('inbox_tickets.id')
      .firstOrFail()

    const agent = await inbox.attendants.forUser(Math.floor(Math.random() * 1e9))

    // SAFETY: the id the queue insert above returned.
    await inbox.queues.addMember(queueId as QueueId, agent)

    // SAFETY: the id of the ticket row the ingest opened.
    return { receipt, address, agent, ticketId: ticket.id as TicketId }
  }

  async function messageRow(id: MessageId) {
    const db = await app.container.make('lucid.db')

    return db.from('inbox_messages').where('id', id).firstOrFail()
  }

  test('a reply is stored pending, claimed, then sent exactly once', async ({ assert }) => {
    const { receipt, address, agent, ticketId } = await inboundTicket()
    const db = await app.container.make('lucid.db')
    const during: Array<{ status: string; claimed: boolean }> = []

    fake.respond = async message => {
      const row = await db
        .from('inbox_messages')
        .where('client_ref', message.clientRef)
        .firstOrFail()

      during.push({ status: row.status, claimed: row.dispatched_at !== null })

      return { status: 'accepted', externalId: 'wamid.sent' }
    }

    const result = await inbox.messages.send(ticketId, { text: 'On it!' }, agent)

    assert.equal(receipt, 'accepted')
    assert.equal(result.outcome, 'queued')
    assert.deepEqual(during, [{ status: 'pending', claimed: true }])
    assert.deepEqual(
      fake.sends.map(({ message }) => ({ to: message.to.address, text: message.text })),
      [{ to: address, text: 'On it!' }],
    )

    const row = result.outcome === 'queued' ? await messageRow(result.messageId) : null

    assert.deepInclude(row, { status: 'sent', external_id: 'wamid.sent' })
  })

  test('a dispatch that runs again while the first holds the lease sends nothing', async ({
    assert,
  }) => {
    const { agent, ticketId } = await inboundTicket()
    const db = await app.container.make('lucid.db')

    fake.respond = async message => {
      const row = await db
        .from('inbox_messages')
        .where('client_ref', message.clientRef)
        .firstOrFail()

      await inbox.run({ task: 'dispatch', messageId: row.id, attempt: 0 })

      return { status: 'accepted', externalId: randomUUID() }
    }

    const result = await inbox.messages.send(ticketId, { text: 'Once' }, agent)

    if (result.outcome !== 'queued') throw new Error(`the send was ${result.outcome}`)

    await inbox.run({ task: 'dispatch', messageId: result.messageId, attempt: 0 })

    assert.lengthOf(fake.sends, 1)
    assert.equal((await messageRow(result.messageId)).status, 'sent')
  })

  test('a send that fails before leaving releases the lease for the retry', async ({ assert }) => {
    const { agent, ticketId } = await inboundTicket()

    fake.respond = async () => {
      throw new Error('connection refused')
    }

    const result = await inbox.messages.send(ticketId, { text: 'Retry me' }, agent)

    if (result.outcome !== 'queued') throw new Error(`the send was ${result.outcome}`)

    const released = await messageRow(result.messageId)

    fake.respond = async () => ({ status: 'accepted', externalId: randomUUID() })
    await inbox.run({ task: 'dispatch', messageId: result.messageId, attempt: 1 })

    assert.deepInclude(released, { status: 'pending', dispatched_at: null })
    assert.lengthOf(fake.sends, 2)
    assert.equal((await messageRow(result.messageId)).status, 'sent')
  })

  test('a rejected send fails with the provider code', async ({ assert }) => {
    const { agent, ticketId } = await inboundTicket()

    fake.respond = async () => ({ status: 'rejected', code: 'recipient_invalid' })

    const result = await inbox.messages.send(ticketId, { text: 'Nope' }, agent)

    if (result.outcome !== 'queued') throw new Error(`the send was ${result.outcome}`)

    assert.deepInclude(await messageRow(result.messageId), {
      status: 'failed',
      failure_code: 'recipient_invalid',
    })
  })
})
