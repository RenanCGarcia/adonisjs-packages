import { randomUUID } from 'node:crypto'

import type { ApplicationService } from '@adonisjs/core/types'
import { DateTime } from 'luxon'

import { fakeWebhookBody } from '../../src/testing/main.ts'
import type { QueueId, TicketId } from '../../src/types.ts'

/**
 * A channel on a fresh queue, inserted as the host's rows, and a contact writing in through the
 * real webhook entry.
 */
export async function channelIn(app: ApplicationService, provider = 'fake') {
  const db = await app.container.make('lucid.db')
  const inbox = await app.container.make('inbox')
  const now = '2026-01-05 10:00:00'
  const token = randomUUID()
  const address = `+55${randomUUID()}`
  const [queueId] = await db.table('inbox_queues').insert({ name: 'support', created_at: now })

  const [channelId] = await db.table('inbox_channels').insert({
    provider,
    name: 'test',
    default_queue_id: queueId,
    webhook_token: token,
    credentials: JSON.stringify({ secret: 's3cret' }),
    created_at: now,
  })

  const write = (text: string) =>
    inbox.ingest(token, {
      headers: { 'x-fake-secret': 's3cret' },
      rawBody: fakeWebhookBody({
        type: 'message_received',
        externalId: randomUUID(),
        from: { address },
        content: { kind: 'text', text },
        sentAt: DateTime.now(),
      }),
    })

  const openTicket = async () => {
    const row = await db
      .from('inbox_tickets')
      .join('inbox_conversations', 'inbox_conversations.id', 'inbox_tickets.conversation_id')
      .where('inbox_conversations.channel_id', channelId)
      .whereNotNull('inbox_tickets.open_conversation_id')
      .select('inbox_tickets.id')
      .firstOrFail()

    // SAFETY: the id of a ticket row.
    return row.id as TicketId
  }

  // SAFETY: the id the queue insert above returned.
  return { channelId, queueId: queueId as QueueId, token, address, write, openTicket }
}

/**
 * Waits for a condition that a delayed task makes true.
 */
export async function eventually(condition: () => boolean | Promise<boolean>, timeoutMs = 3000) {
  const deadline = Date.now() + timeoutMs

  while (!(await condition())) {
    if (Date.now() > deadline) throw new Error(`still false after ${timeoutMs}ms`)

    await new Promise(resolve => setTimeout(resolve, 20))
  }
}
