import { randomUUID } from 'node:crypto'

import type { ApplicationService } from '@adonisjs/core/types'
import { test } from '@japa/runner'

import { adapters } from '../src/adapters/main.ts'
import { defineConfig, type AuthorizeQuestion } from '../src/define_config.ts'
import type { Inbox } from '../src/inbox.ts'
import type { Attendant, InboxEvents } from '../src/types.ts'
import { boot, migrateFixture, fixtureBots, fixtureModels } from './helpers/app.ts'

/**
 * Called by `authorize`, after the ticket was read and before it is written, which is where a
 * concurrent writer gets in.
 */
let meanwhile: (question: AuthorizeQuestion) => Promise<void> = async () => {}

const writesConfig = () =>
  defineConfig({
    models: fixtureModels(),
    bots: fixtureBots(),
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
    await migrateFixture()
    app = await boot(writesConfig())
    inbox = await app.container.make('inbox')

    return () => app.terminate()
  })

  group.each.teardown(() => {
    meanwhile = async () => {}
  })

  /**
   * The queue, channel, contact and conversation are the host's rows, so they are created through
   * its models. The memberships and the ticket go through the inbox.
   */
  async function ticketIn(...members: Attendant[]) {
    const queue = await (await inbox.model('queue')).create({ name: 'support' })

    const channel = await (
      await inbox.model('channel')
    ).create({
      provider: 'fake',
      name: 'test',
      defaultQueueId: queue.id,
      webhookToken: randomUUID(),
      credentials: {},
    })

    const contact = await (
      await inbox.model('contact')
    ).create({
      channelId: channel.id,
      address: randomUUID(),
    })

    const conversation = await (
      await inbox.model('conversation')
    ).create({
      channelId: channel.id,
      contactId: contact.id,
    })

    for (const member of members) await inbox.queues.addMember(queue.id, member)

    const { ticket } = await inbox.tickets.open(conversation.id, queue.id, {
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
    const { ticket, ...models } = fixtureModels()

    // @ts-expect-error a JavaScript config can leave a role out, which only the boot catches.
    const config = defineConfig({ models, bots: {}, channels: {} })

    assert.exists(ticket)
    await assert.rejects(() => boot(config), /config.models is missing ticket/)
  })
})
