import { randomUUID } from 'node:crypto'

import type { ApplicationService } from '@adonisjs/core/types'
import { DateTime } from 'luxon'

import { fakeWebhookBody } from '../adapters/fake.ts'
import type { TicketId } from '../types.ts'

/**
 * A channel on a fresh queue, created through the host's models, and a contact writing in through the
 * real webhook entry.
 */
export async function channelIn(app: ApplicationService, provider = 'fake') {
  const db = await app.container.make('lucid.db')
  const inbox = await app.container.make('inbox')
  const token = randomUUID()
  const address = `+55${randomUUID()}`
  const Queue = await inbox.model('queue')
  const Channel = await inbox.model('channel')
  const queue = await Queue.create({ name: 'support' })

  const channel = await Channel.create({
    provider,
    name: 'test',
    defaultQueueId: queue.id,
    webhookToken: token,
    credentials: { secret: 's3cret' },
  })

  const channelId = channel.id

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

  return { channelId, queueId: queue.id, token, address, write, openTicket }
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
