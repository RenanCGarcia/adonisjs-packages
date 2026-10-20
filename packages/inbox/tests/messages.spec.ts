import { randomUUID } from 'node:crypto'

import { test } from '@japa/runner'
import { DateTime } from 'luxon'

import type { NormalizedEvent } from '../src/adapters/port.ts'
import { eventually, fakeWebhookBody } from '../src/testing/main.ts'
import type { TicketId } from '../src/types.ts'
import { agent, bootFixture, channelOn, host, queue, type Agent } from './helpers/host.ts'

type Channel = Awaited<ReturnType<typeof channelOn>>

type Value = string | number | null

/**
 * The columns these specs read back, each present when its query selects it.
 */
interface Row {
  id?: number
  name?: string | null
  status?: string | null
  queue_id?: number
  unread_count?: number
  data?: string
  actor_kind?: string
  actor_source?: string | null
  note?: string | null
  direction?: string
  kind?: string
  body?: string
  external_id?: string | null
  author_id?: number | null
  client_ref?: string | null
  dispatched_at?: Date | string | null
}

async function select(sql: string, ...params: Value[]): Promise<Row[]> {
  const result = await host().db.rawQuery(sql, params)

  // pg answers a raw query with the driver's result, sqlite with the rows.
  return Array.isArray(result) ? result : result.rows
}

/**
 * The provider posting `events` to the channel's webhook route.
 */
function webhook(channel: Channel, events: NormalizedEvent[], secret = channel.secret) {
  return host().inbox.ingest(channel.webhookToken, {
    headers: { 'content-type': 'application/json', 'x-fake-secret': secret },
    rawBody: fakeWebhookBody(...events),
  })
}

function reply(by: Agent, ticketId: TicketId, text: string, clientRef?: string) {
  return host().inbox.messages.send(ticketId, { kind: 'text', text }, by.me, { clientRef })
}

function received(address: string, externalId: string = randomUUID()): NormalizedEvent {
  return {
    type: 'message_received',
    externalId,
    from: { address },
    profileName: 'Maria',
    content: { kind: 'text', text: 'hello' },
    sentAt: DateTime.fromISO('2026-01-05T10:00:00.000Z'),
  }
}

/**
 * A contact writes in on a fresh channel, which opens a queued ticket in a queue `members` belong to.
 */
async function inboundTicket(...members: Agent[]) {
  const queueId = await queue(...members)
  const channel = await channelOn(queueId)
  const address = `+55${randomUUID()}`

  await webhook(channel, [received(address)])

  const [row] = await select(
    `SELECT inbox_tickets.id FROM inbox_tickets
     JOIN inbox_conversations ON inbox_conversations.id = inbox_tickets.conversation_id
     WHERE inbox_conversations.channel_id = ?`,
    channel.id,
  )

  // SAFETY: the id of the ticket row the webhook opened.
  return { channel, address, queueId, ticketId: Number(row?.id) as TicketId }
}

async function messagesOf(ticketId: number) {
  return select(
    'SELECT direction, kind, body, status, external_id, author_id, client_ref, dispatched_at FROM inbox_messages WHERE ticket_id = ? ORDER BY id',
    ticketId,
  )
}

test.group('messages', group => {
  bootFixture(group)

  test('a webhook opens a ticket for a new contact and counts the message unread', async ({
    assert,
  }) => {
    const queueId = await queue()
    const channel = await channelOn(queueId)
    const address = `+55${randomUUID()}`
    const event = received(address, 'wamid.first')

    assert.equal(await webhook(channel, [event]), 'accepted')

    const contacts = await select(
      'SELECT id, name FROM inbox_contacts WHERE channel_id = ? AND address = ?',
      channel.id,
      address,
    )

    const tickets = await select(
      `SELECT inbox_tickets.id, status, queue_id, unread_count FROM inbox_tickets
       JOIN inbox_conversations ON inbox_conversations.id = inbox_tickets.conversation_id
       WHERE inbox_conversations.contact_id = ?`,
      Number(contacts[0]?.id),
    )

    const ticketId = Number(tickets[0]?.id)

    assert.deepEqual(
      contacts.map(contact => contact.name),
      ['Maria'],
    )
    assert.deepEqual(tickets, [
      { id: ticketId, status: 'queued', queue_id: queueId, unread_count: 1 },
    ])
    assert.deepEqual(await messagesOf(ticketId), [
      {
        direction: 'inbound',
        kind: 'text',
        body: 'hello',
        status: null,
        external_id: 'wamid.first',
        author_id: null,
        client_ref: null,
        dispatched_at: null,
      },
    ])
    assert.deepEqual(
      (
        await select(
          'SELECT data, actor_source FROM inbox_ticket_events WHERE ticket_id = ?',
          ticketId,
        )
      ).map(row => ({ data: JSON.parse(String(row.data)), actor_source: row.actor_source })),
      [{ data: { fact: 'opened', queueId, origin: 'inbound' }, actor_source: 'ingest' }],
    )
    assert.lengthOf(
      await select(
        'SELECT id FROM inbox_channel_events WHERE channel_id = ? AND processed_at IS NOT NULL',
        channel.id,
      ),
      1,
    )
  })

  test('a repeated webhook stores one message on one ticket', async ({ assert }) => {
    const channel = await channelOn(await queue())
    const event = received(`+55${randomUUID()}`)

    assert.deepEqual(
      [await webhook(channel, [event]), await webhook(channel, [event])],
      ['accepted', 'accepted'],
    )

    const tickets = await select(
      `SELECT inbox_tickets.id, unread_count FROM inbox_tickets
       JOIN inbox_conversations ON inbox_conversations.id = inbox_tickets.conversation_id
       WHERE inbox_conversations.channel_id = ?`,
      channel.id,
    )

    assert.lengthOf(tickets, 1)
    assert.equal(tickets[0]?.unread_count, 1)
    assert.lengthOf(await messagesOf(Number(tickets[0]?.id)), 1)
  })

  test('a webhook with the wrong secret or token is refused and stored nowhere', async ({
    assert,
  }) => {
    const channel = await channelOn(await queue())
    const event = received(`+55${randomUUID()}`)

    const forged = await webhook(channel, [event], 'not-the-secret')
    const unknown = await webhook({ ...channel, webhookToken: randomUUID() }, [event])

    assert.deepEqual([forged, unknown], ['invalid_signature', 'unknown_channel'])
    assert.lengthOf(
      await select('SELECT id FROM inbox_channel_events WHERE channel_id = ?', channel.id),
      0,
    )
  })

  test('a reply to a queued ticket assumes it and goes out', async ({ assert }) => {
    const ana = await agent()
    const { ticketId } = await inboundTicket(ana)

    const sent = await reply(ana, ticketId, 'On it!')
    const [inbound, outbound] = await messagesOf(ticketId)

    assert.equal(sent.outcome, 'queued')
    assert.deepInclude(sent.outcome === 'queued' && sent.ticket, { unreadCount: 0 })
    assert.equal(sent.outcome === 'queued' && sent.ticket.state.status, 'in_progress')
    assert.equal(inbound?.direction, 'inbound')
    assert.deepInclude(outbound, {
      direction: 'outbound',
      kind: 'text',
      body: 'On it!',
      status: 'sent',
    })
    assert.isString(outbound?.external_id)
    assert.isNotNull(outbound?.dispatched_at)
    assert.deepEqual(
      (
        await select(
          "SELECT data FROM inbox_ticket_events WHERE ticket_id = ? AND type = 'assignment_changed'",
          ticketId,
        )
      ).map(row => JSON.parse(String(row.data)).via),
      ['reply'],
    )
  })

  test('a reply to a ticket another agent holds is rejected and stores nothing', async ({
    assert,
  }) => {
    const ana = await agent()
    const bea = await agent()
    const { ticketId } = await inboundTicket(ana, bea)

    await ana.assume({ id: ticketId })
    const refused = await reply(bea, ticketId, 'Mine?')

    assert.deepEqual(refused, { outcome: 'rejected', reason: 'not_assignee' })
    assert.deepEqual(
      (await messagesOf(ticketId)).map(message => message.direction),
      ['inbound'],
    )
  })

  test('a retried POST with the same idempotency key stores one message', async ({ assert }) => {
    const ana = await agent()
    const { ticketId } = await inboundTicket(ana)
    const key = randomUUID()

    const first = await reply(ana, ticketId, 'Once', key)
    const retry = await reply(ana, ticketId, 'Once', key)

    assert.equal(retry.outcome, 'queued')
    assert.equal(
      retry.outcome === 'queued' && retry.messageId,
      first.outcome === 'queued' && first.messageId,
    )
    assert.lengthOf(await select('SELECT id FROM inbox_messages WHERE client_ref = ?', key), 1)
  })

  test('statuses arriving out of order never move a message back', async ({ assert }) => {
    const ana = await agent()
    const { channel, ticketId } = await inboundTicket(ana)
    const hi = await reply(ana, ticketId, 'Hi')

    if (hi.outcome !== 'queued') throw new Error(`the reply was ${hi.outcome}`)

    const [sent] = await select('SELECT external_id FROM inbox_messages WHERE id = ?', hi.messageId)

    const externalId = String(sent?.external_id)

    const status = (to: 'delivered' | 'read'): NormalizedEvent => ({
      type: 'message_status_changed',
      externalId,
      status: to,
    })

    await webhook(channel, [status('read')])
    await webhook(channel, [status('delivered')])

    const [message] = await select('SELECT status FROM inbox_messages WHERE id = ?', hi.messageId)

    assert.equal(message?.status, 'read')
  })

  test('an echo of our own send is skipped, and one sent from the phone is stored', async ({
    assert,
  }) => {
    const ana = await agent()
    const { channel, address, ticketId } = await inboundTicket(ana)
    const hi = await reply(ana, ticketId, 'Hi')

    if (hi.outcome !== 'queued') throw new Error(`the reply was ${hi.outcome}`)

    const [sent] = await select('SELECT external_id FROM inbox_messages WHERE id = ?', hi.messageId)

    const echo = (externalId: string, text: string): NormalizedEvent => ({
      type: 'message_echoed',
      externalId,
      to: { address },
      content: { kind: 'text', text },
      sentAt: DateTime.fromISO('2026-01-05T10:05:00.000Z'),
    })

    await webhook(channel, [
      echo(String(sent?.external_id), 'Hi'),
      echo('wamid.phone', 'From my phone'),
    ])

    assert.deepEqual(
      (await messagesOf(ticketId)).map(message => [
        message.direction,
        message.body,
        message.status,
      ]),
      [
        ['inbound', 'hello', null],
        ['outbound', 'Hi', 'sent'],
        ['outbound', 'From my phone', 'sent'],
      ],
    )
  })

  test('the triage bot greets a contact on a triage channel, then hands the ticket back', async ({
    assert,
  }) => {
    const channel = await channelOn(await queue(), 'triage')
    const address = `+55${randomUUID()}`

    const replies = async () =>
      (await messagesOf(ticketId)).filter(message => message.direction === 'outbound')

    const sent = async () => (await replies()).filter(message => message.status === 'sent').length

    await webhook(channel, [received(address)])

    const [row] = await select(
      `SELECT inbox_tickets.id FROM inbox_tickets
       JOIN inbox_conversations ON inbox_conversations.id = inbox_tickets.conversation_id
       WHERE inbox_conversations.channel_id = ?`,
      channel.id,
    )

    const ticketId = Number(row?.id)

    await eventually(async () => (await sent()) === 1, 5000)
    await webhook(channel, [
      {
        type: 'message_received',
        externalId: randomUUID(),
        from: { address },
        content: { kind: 'text', text: 'My order is late' },
        sentAt: DateTime.now(),
      },
    ])
    await eventually(async () => (await sent()) === 2, 5000)

    const [ticket] = await select('SELECT status FROM inbox_tickets WHERE id = ?', ticketId)

    const handoffs = await select(
      `SELECT actor_kind, actor_source, note FROM inbox_ticket_events
       WHERE ticket_id = ? AND type = 'assignment_changed' ORDER BY id`,
      ticketId,
    )

    assert.deepEqual(
      (await replies()).map(message => [message.body, message.status]),
      [
        ['Hi! What do you need help with?', 'sent'],
        ['Thanks! Someone from the team will take it from here.', 'sent'],
      ],
    )
    assert.deepInclude(ticket, { status: 'queued' })
    assert.deepEqual(
      handoffs.map(event => ({ ...event })),
      [
        { actor_kind: 'system', actor_source: 'assign_on_open', note: null },
        { actor_kind: 'bot', actor_source: null, note: 'My order is late' },
      ],
    )
  })
})
