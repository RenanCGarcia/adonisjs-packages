import { randomUUID } from 'node:crypto'

import type { ApplicationService } from '@adonisjs/core/types'
import { test } from '@japa/runner'
import { DateTime } from 'luxon'

import { adapters } from '../src/adapters/main.ts'
import { defineConfig } from '../src/define_config.ts'
import type { Inbox } from '../src/inbox.ts'
import { tasks } from '../src/tasks.ts'
import { FakeChannelAdapter, fakeWebhookBody } from '../src/testing/main.ts'
import type { MessageId, TicketId } from '../src/types.ts'
import { boot, migratePlayground, playgroundModels } from './helpers/app.ts'

const fake = new FakeChannelAdapter()

const receiveOnly = new FakeChannelAdapter(['outbound_echo'])

let allowSends = true

test.group('outbox', group => {
  let app: ApplicationService
  let inbox: Inbox

  group.setup(async () => {
    await migratePlayground()

    app = await boot(
      defineConfig({
        models: playgroundModels(),
        bots: {},
        channels: { fake: adapters.fake(fake), receive_only: adapters.fake(receiveOnly) },
        tasks: tasks.inline(),
        authorize: ({ operation }) => allowSends || operation.gesture !== 'send',
      }),
    )
    inbox = await app.container.make('inbox')

    return () => app.terminate()
  })

  group.each.setup(() => {
    fake.reset()
    receiveOnly.reset()
    allowSends = true
  })

  /**
   * A contact writes in through the real webhook entry, and an agent of the channel's queue
   * replies to the ticket that opened.
   */
  async function inboundTicket(provider = 'fake') {
    const db = await app.container.make('lucid.db')
    const token = randomUUID()
    const queue = await (await inbox.model('queue')).create({ name: 'support' })

    const { id: channelId } = await (
      await inbox.model('channel')
    ).create({
      provider,
      name: 'test',
      defaultQueueId: queue.id,
      webhookToken: token,
      credentials: { secret: 's3cret' },
    })

    const address = `+55${randomUUID()}`

    const receipt = await inbox.ingest(token, {
      headers: { 'x-fake-secret': 's3cret' },
      rawBody: fakeWebhookBody({
        type: 'message_received',
        externalId: randomUUID(),
        from: { address },
        content: { kind: 'text', text: 'hello' },
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

    await inbox.queues.addMember(queue.id, agent)

    // SAFETY: the id of the ticket row the ingest opened.
    return { receipt, address, agent, channelId, token, ticketId: ticket.id as TicketId }
  }

  /**
   * A time as the playground's database stores it, `minutes` ago.
   */
  async function minutesAgo(minutes: number) {
    const db = await app.container.make('lucid.db')

    return DateTime.now().minus({ minutes }).toFormat(db.connection().dialect.dateTimeFormat)
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

    const result = await inbox.messages.send(ticketId, { kind: 'text', text: 'On it!' }, agent)

    assert.equal(receipt, 'accepted')
    assert.equal(result.outcome, 'queued')
    assert.deepEqual(during, [{ status: 'pending', claimed: true }])
    assert.deepEqual(
      fake.sends.map(({ message }) => ({ to: message.to.address, content: message.content })),
      [{ to: address, content: { kind: 'text', text: 'On it!' } }],
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

    const result = await inbox.messages.send(ticketId, { kind: 'text', text: 'Once' }, agent)

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

    const result = await inbox.messages.send(ticketId, { kind: 'text', text: 'Retry me' }, agent)

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

    const result = await inbox.messages.send(ticketId, { kind: 'text', text: 'Nope' }, agent)

    if (result.outcome !== 'queued') throw new Error(`the send was ${result.outcome}`)

    assert.deepInclude(await messageRow(result.messageId), {
      status: 'failed',
      failure_code: 'recipient_invalid',
    })
  })

  test('content the adapter cannot send is rejected and stores nothing', async ({ assert }) => {
    const { agent, ticketId } = await inboundTicket('receive_only')

    const result = await inbox.messages.send(ticketId, { kind: 'text', text: 'Hi' }, agent)
    const db = await app.container.make('lucid.db')

    const outbound = await db
      .from('inbox_messages')
      .where('ticket_id', ticketId)
      .where('direction', 'outbound')

    assert.deepEqual(result, { outcome: 'rejected', reason: 'unsupported_content' })
    assert.lengthOf(outbound, 0)
    assert.lengthOf(receiveOnly.sends, 0)
  })

  test('recover sends a pending message whose dispatch died, once its lease expired', async ({
    assert,
  }) => {
    const { agent, ticketId } = await inboundTicket()
    const db = await app.container.make('lucid.db')

    fake.respond = async () => {
      throw new Error('connection refused')
    }

    const result = await inbox.messages.send(ticketId, { kind: 'text', text: 'Late' }, agent)

    if (result.outcome !== 'queued') throw new Error(`the send was ${result.outcome}`)

    fake.respond = async () => ({ status: 'accepted', externalId: randomUUID() })

    const sentAt = await minutesAgo(10)

    const claimedAt = (dispatchedAt: string) =>
      db
        .from('inbox_messages')
        .where('id', result.messageId)
        .update({ sent_at: sentAt, dispatched_at: dispatchedAt })

    await claimedAt(await minutesAgo(1))
    await inbox.recover()

    const leased = await messageRow(result.messageId)

    await claimedAt(await minutesAgo(10))
    await inbox.recover()
    await inbox.recover()

    assert.equal(leased.status, 'pending')
    assert.lengthOf(fake.sends, 2)
    assert.equal((await messageRow(result.messageId)).status, 'sent')
  })

  test('recover ingests a stored webhook whose task was lost', async ({ assert }) => {
    const { address, channelId } = await inboundTicket()
    const db = await app.container.make('lucid.db')

    const store = async (externalId: string, minutes: number) => {
      const { id } = await (
        await inbox.model('channelEvent')
      ).create({
        channelId,
        rawBody: fakeWebhookBody({
          type: 'message_received',
          externalId,
          from: { address },
          content: { kind: 'text', text: 'are you there?' },
          sentAt: DateTime.now(),
        }),
        receivedAt: DateTime.now().minus({ minutes }),
      })

      return id
    }

    const [lostId, freshId] = [randomUUID(), randomUUID()]
    const lost = await store(lostId, 10)
    const fresh = await store(freshId, 0)

    await inbox.recover()

    const processed = await db
      .from('inbox_channel_events')
      .whereIn('id', [lost, fresh])
      .whereNotNull('processed_at')
      .select('id')

    const stored = await db
      .from('inbox_messages')
      .whereIn('external_id', [lostId, freshId])
      .select('external_id')

    assert.deepEqual(
      processed.map(row => row.id),
      [lost],
    )
    assert.deepEqual(
      stored.map(row => row.external_id),
      [lostId],
    )
  })

  test('recover gives up on work older than a day instead of queueing it again', async ({
    assert,
  }) => {
    const { agent, channelId, ticketId } = await inboundTicket()
    const db = await app.container.make('lucid.db')
    const emitter = await app.container.make('emitter')

    fake.respond = async () => {
      throw new Error('connection refused')
    }

    const result = await inbox.messages.send(ticketId, { kind: 'text', text: 'Stale' }, agent)

    if (result.outcome !== 'queued') throw new Error(`the send was ${result.outcome}`)

    fake.respond = async () => ({ status: 'accepted', externalId: randomUUID() })

    const longAgo = await minutesAgo(2 * 24 * 60)

    await db.from('inbox_messages').where('id', result.messageId).update({ sent_at: longAgo })

    const { id: eventId } = await (
      await inbox.model('channelEvent')
    ).create({
      channelId,
      rawBody: '[]',
      receivedAt: DateTime.now().minus({ days: 2 }),
    })

    const failed: MessageId[] = []

    const listener = async ({ messageId, status }: { messageId: MessageId; status: string }) => {
      if (status === 'failed') failed.push(messageId)
    }

    emitter.on('inbox:message_status_changed', listener)

    try {
      await inbox.recover()
    } finally {
      emitter.off('inbox:message_status_changed', listener)
    }

    const again = await inbox.recover()
    const event = await db.from('inbox_channel_events').where('id', eventId).firstOrFail()

    assert.deepInclude(await messageRow(result.messageId), {
      status: 'failed',
      failure_code: 'expired',
    })
    assert.include(failed, result.messageId)
    assert.isNull(event.processed_at)
    assert.isNotNull(event.failed_at)
    assert.lengthOf(fake.sends, 1)
    assert.deepEqual(again.gaveUp, { channelEvents: 0, messages: 0 })
  })

  test('a send authorize refuses is forbidden and stores nothing', async ({ assert }) => {
    const { agent, ticketId } = await inboundTicket()
    const db = await app.container.make('lucid.db')

    allowSends = false

    const result = await inbox.messages.send(ticketId, { kind: 'text', text: 'Hi' }, agent)

    const outbound = await db
      .from('inbox_messages')
      .where('ticket_id', ticketId)
      .where('direction', 'outbound')

    assert.deepEqual(result, { outcome: 'rejected', reason: 'forbidden' })
    assert.lengthOf(outbound, 0)
    assert.lengthOf(fake.sends, 0)
  })

  test('an echo of a send still in flight waits for it, then dedupes against it', async ({
    assert,
  }) => {
    const { address, channelId, token, agent, ticketId } = await inboundTicket()
    const db = await app.container.make('lucid.db')

    fake.respond = async () => {
      await inbox.ingest(token, {
        headers: { 'x-fake-secret': 's3cret' },
        rawBody: fakeWebhookBody({
          type: 'message_echoed',
          externalId: 'wamid.echoed',
          to: { address },
          content: { kind: 'text', text: 'Hi' },
          sentAt: DateTime.now(),
        }),
      })

      return { status: 'accepted', externalId: 'wamid.echoed' }
    }

    await inbox.messages.send(ticketId, { kind: 'text', text: 'Hi' }, agent)

    const waiting = await db
      .from('inbox_channel_events')
      .where('channel_id', channelId)
      .whereNull('processed_at')
      .firstOrFail()

    await inbox.run({ task: 'ingest', channelEventId: waiting.id, attempt: 1 })

    const outbound = await db
      .from('inbox_messages')
      .where('ticket_id', ticketId)
      .where('direction', 'outbound')
      .select('external_id', 'status')

    assert.deepEqual(outbound, [{ external_id: 'wamid.echoed', status: 'sent' }])
  })
})
