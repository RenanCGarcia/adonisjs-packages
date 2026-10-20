import { randomUUID } from 'node:crypto'

import type { ApplicationService } from '@adonisjs/core/types'
import { column } from '@adonisjs/lucid/orm'
import { test } from '@japa/runner'
import { DateTime } from 'luxon'

import { adapters } from '../src/adapters/main.ts'
import { defineConfig } from '../src/define_config.ts'
import type { Inbox } from '../src/inbox.ts'
import { fakeWebhookBody } from '../src/testing/main.ts'
import type { QueueId, TicketId } from '../src/types.ts'
import { boot, migratePlayground, playgroundModels } from './helpers/app.ts'

/**
 * A host that keeps a tenant on each row the inbox creates.
 */
const OWNED_TABLES = ['inbox_contacts', 'inbox_conversations', 'inbox_tickets', 'inbox_messages']

/**
 * The playground's model of `role` with the host's `tenant_id` column.
 */
function owned<R extends 'contact' | 'conversation' | 'ticket' | 'message'>(role: R) {
  const load = async () => {
    const { default: Base } = await playgroundModels()[role]()

    class Owned extends Base {
      static table = Base.table

      @column()
      declare tenantId: string | null
    }

    return { default: Owned }
  }

  let loaded: ReturnType<typeof load> | undefined

  return () => (loaded ??= load())
}

test.group('ownership', group => {
  let app: ApplicationService
  let inbox: Inbox

  group.setup(async () => {
    await migratePlayground()

    app = await boot(
      defineConfig({
        models: {
          ...playgroundModels(),
          contact: owned('contact'),
          conversation: owned('conversation'),
          ticket: owned('ticket'),
          message: owned('message'),
        },
        bots: {},
        channels: { fake: adapters.fake() },
        ownership: channel => ({ tenantId: channel.name }),
      }),
    )
    inbox = await app.container.make('inbox')

    const db = await app.container.make('lucid.db')

    for (const table of OWNED_TABLES) {
      if (!(await db.connection().schema.hasColumn(table, 'tenant_id'))) {
        await db.rawQuery(`ALTER TABLE ${table} ADD COLUMN tenant_id varchar(255)`)
      }
    }

    return async () => {
      for (const table of OWNED_TABLES) {
        await db.rawQuery(`ALTER TABLE ${table} DROP COLUMN tenant_id`)
      }

      await app.terminate()
    }
  })

  test('every row a channel creates carries what ownership returns for it', async ({ assert }) => {
    const db = await app.container.make('lucid.db')
    const now = '2026-01-05 10:00:00'
    const token = randomUUID()
    const tenant = `tenant-${randomUUID()}`
    const [queueId] = await db.table('inbox_queues').insert({ name: 'support', created_at: now })

    const [channelId] = await db.table('inbox_channels').insert({
      provider: 'fake',
      name: tenant,
      default_queue_id: queueId,
      webhook_token: token,
      credentials: JSON.stringify({ secret: 's3cret' }),
      created_at: now,
    })

    await inbox.ingest(token, {
      headers: { 'x-fake-secret': 's3cret' },
      rawBody: fakeWebhookBody({
        type: 'message_received',
        externalId: randomUUID(),
        from: { address: `+55${randomUUID()}` },
        content: { kind: 'text', text: 'hello' },
        sentAt: DateTime.now(),
      }),
    })

    const conversation = await db
      .from('inbox_conversations')
      .where('channel_id', channelId)
      .firstOrFail()

    const ticket = await db
      .from('inbox_tickets')
      .where('conversation_id', conversation.id)
      .firstOrFail()

    const agent = await inbox.attendants.forUser(Math.floor(Math.random() * 1e9))

    // SAFETY: the id the queue insert above returned.
    await inbox.queues.addMember(queueId as QueueId, agent)

    // SAFETY: the id of the ticket row the ingest opened.
    await inbox.messages.send(ticket.id as TicketId, { kind: 'text', text: 'hi' }, agent)

    const tenants = async (table: string, column: string, id: number) =>
      (await db.from(table).where(column, id).select('tenant_id')).map(row => row.tenant_id)

    assert.deepEqual(
      {
        contacts: await tenants('inbox_contacts', 'id', conversation.contact_id),
        conversations: await tenants('inbox_conversations', 'id', conversation.id),
        tickets: await tenants('inbox_tickets', 'id', ticket.id),
        messages: await tenants('inbox_messages', 'ticket_id', ticket.id),
      },
      {
        contacts: [tenant],
        conversations: [tenant],
        tickets: [tenant],
        messages: [tenant, tenant],
      },
    )
  })
})
