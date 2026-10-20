import { randomUUID } from 'node:crypto'

import type { ApplicationService } from '@adonisjs/core/types'
import { column } from '@adonisjs/lucid/orm'
import { test } from '@japa/runner'
import { DateTime } from 'luxon'

import { adapters } from '../src/adapters/main.ts'
import { automations } from '../src/automations.ts'
import { defineConfig } from '../src/define_config.ts'
import type { Inbox } from '../src/inbox.ts'
import { fakeWebhookBody } from '../src/testing/main.ts'
import type { TicketId } from '../src/types.ts'
import { boot, migratePlayground, playgroundModels } from './helpers/app.ts'

/**
 * A host that keeps a tenant on each row the inbox creates.
 */
const OWNED_TABLES = [
  'inbox_channel_events',
  'inbox_contacts',
  'inbox_conversations',
  'inbox_tickets',
  'inbox_ticket_events',
  'inbox_messages',
]

/**
 * The playground's model of `role` with the host's `tenant_id` column.
 */
function owned<
  R extends 'channelEvent' | 'contact' | 'conversation' | 'ticket' | 'ticketEvent' | 'message',
>(role: R) {
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

function inbound() {
  return fakeWebhookBody({
    type: 'message_received',
    externalId: randomUUID(),
    from: { address: `+55${randomUUID()}` },
    content: { kind: 'text', text: 'hello' },
    sentAt: DateTime.now(),
  })
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
          channelEvent: owned('channelEvent'),
          contact: owned('contact'),
          conversation: owned('conversation'),
          ticket: owned('ticket'),
          ticketEvent: owned('ticketEvent'),
          message: owned('message'),
        },
        bots: {},
        automations: [automations.closeInactive({ after: { hours: 48 } })],
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

  /**
   * A channel named after its tenant, and a contact writing in through it.
   */
  async function writingIn(tenant: string) {
    const db = await app.container.make('lucid.db')
    const token = randomUUID()
    const queue = await (await inbox.model('queue')).create({ name: 'support' })

    const { id: channelId } = await (
      await inbox.model('channel')
    ).create({
      provider: 'fake',
      name: tenant,
      defaultQueueId: queue.id,
      webhookToken: token,
      credentials: { secret: 's3cret' },
    })

    await inbox.ingest(token, {
      headers: { 'x-fake-secret': 's3cret' },
      rawBody: inbound(),
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

    await inbox.queues.addMember(queue.id, agent)

    // SAFETY: the id of the ticket row the ingest opened.
    return { channelId, conversation, agent, ticketId: ticket.id as TicketId }
  }

  /**
   * The tenants of every row the inbox keeps under the channel, by table.
   */
  async function tenantsUnder(channelId: number) {
    const db = await app.container.make('lucid.db')
    const conversations = () => db.from('inbox_conversations').where('channel_id', channelId)

    const tickets = () =>
      db.from('inbox_tickets').whereIn('conversation_id', conversations().select('id'))

    const tenants = async (rows: Promise<Array<{ tenant_id: string }>>) => [
      ...new Set((await rows).map(row => row.tenant_id)),
    ]

    return {
      channelEvents: await tenants(
        db.from('inbox_channel_events').where('channel_id', channelId).select('tenant_id'),
      ),
      contacts: await tenants(
        db.from('inbox_contacts').where('channel_id', channelId).select('tenant_id'),
      ),
      conversations: await tenants(conversations().select('tenant_id')),
      tickets: await tenants(tickets().select('tenant_id')),
      ticketEvents: await tenants(
        db
          .from('inbox_ticket_events')
          .whereIn('ticket_id', tickets().select('id'))
          .select('tenant_id'),
      ),
      messages: await tenants(
        db
          .from('inbox_messages')
          .whereIn('conversation_id', conversations().select('id'))
          .select('tenant_id'),
      ),
    }
  }

  function only(tenant: string) {
    return {
      channelEvents: [tenant],
      contacts: [tenant],
      conversations: [tenant],
      tickets: [tenant],
      ticketEvents: [tenant],
      messages: [tenant],
    }
  }

  async function minutesAgo(minutes: number) {
    const db = await app.container.make('lucid.db')

    return DateTime.now().minus({ minutes }).toFormat(db.connection().dialect.dateTimeFormat)
  }

  test('every row a channel creates carries what ownership returns for it', async ({ assert }) => {
    const tenant = `tenant-${randomUUID()}`
    const { channelId, ticketId, agent } = await writingIn(tenant)

    await inbox.messages.send(ticketId, { kind: 'text', text: 'hi' }, agent)

    assert.deepEqual(await tenantsUnder(channelId), only(tenant))
  })

  test('a tick closes, recovers and dispatches for two tenants in one run, each in its own', async ({
    assert,
  }) => {
    const db = await app.container.make('lucid.db')

    const prepared = await Promise.all(
      [`tenant-${randomUUID()}`, `tenant-${randomUUID()}`].map(async tenant => {
        const { channelId, ticketId, agent } = await writingIn(tenant)
        const reply = await inbox.messages.send(ticketId, { kind: 'text', text: 'On it' }, agent)

        if (reply.outcome !== 'queued') throw new Error(`the reply was ${reply.outcome}`)

        // A dispatch that died after the commit, a webhook whose ingest was lost, and a contact
        // who went quiet three days ago.
        await db
          .from('inbox_messages')
          .where('id', reply.messageId)
          .update({
            status: 'pending',
            external_id: null,
            dispatched_at: null,
            sent_at: await minutesAgo(10),
          })
        await db.table('inbox_channel_events').insert({
          channel_id: channelId,
          raw_body: inbound(),
          received_at: await minutesAgo(10),
          tenant_id: tenant,
        })
        await db
          .from('inbox_tickets')
          .where('id', ticketId)
          .update({ last_activity_at: await minutesAgo(3 * 24 * 60) })

        return { tenant, channelId, ticketId, messageId: reply.messageId }
      }),
    )

    await inbox.tick()

    for (const { tenant, channelId, ticketId, messageId } of prepared) {
      const tickets = await db
        .from('inbox_tickets')
        .join('inbox_conversations', 'inbox_conversations.id', 'inbox_tickets.conversation_id')
        .where('inbox_conversations.channel_id', channelId)
        .orderBy('inbox_tickets.id')
        .select('inbox_tickets.id', 'inbox_tickets.status', 'inbox_tickets.close_reason')

      const message = await db.from('inbox_messages').where('id', messageId).firstOrFail()

      assert.deepEqual(
        tickets.map(row => [row.id === ticketId, row.status, row.close_reason]),
        [
          [true, 'closed', 'inactivity'],
          [false, 'queued', null],
        ],
      )
      assert.equal(message.status, 'sent')
      assert.deepEqual(await tenantsUnder(channelId), only(tenant))
    }
  })
})
