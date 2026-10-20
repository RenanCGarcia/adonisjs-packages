import { execFile } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { promisify } from 'node:util'

import { test } from '@japa/runner'
import { DateTime } from 'luxon'

import type { Database } from '@adonisjs/lucid/database'

import { fixture, fixtureDatabase, fixtureModels, migrateFixture } from './helpers/app.ts'

const run = promisify(execFile)

let db: Database

/**
 * An open ticket on its own queue, channel and contact, whose last activity was `idle` ago.
 */
async function ticketIdleFor(idle: { days: number }) {
  const models = fixtureModels()
  const { default: Queue } = await models.queue()
  const { default: Channel } = await models.channel()
  const { default: Contact } = await models.contact()
  const { default: Conversation } = await models.conversation()
  const { default: Ticket } = await models.ticket()

  const queue = await Queue.create({ name: 'support' })

  const channel = await Channel.create({
    provider: 'fake',
    name: 'test',
    defaultQueueId: queue.id,
    webhookToken: randomUUID(),
    credentials: {},
  })

  const contact = await Contact.create({ channelId: channel.id, address: randomUUID() })

  const conversation = await Conversation.create({ channelId: channel.id, contactId: contact.id })

  const ticket = await Ticket.create({
    conversationId: conversation.id,
    openConversationId: conversation.id,
    queueId: queue.id,
    status: 'queued',
    version: 0,
    botState: {},
    unreadCount: 0,
    openedAt: DateTime.now(),
    lastActivityAt: DateTime.now().minus(idle),
  })

  return ticket.id
}

function ticketRow(id: number) {
  return db
    .from('inbox_tickets')
    .where('id', id)
    .select('status', 'close_reason', 'version')
    .first()
}

test.group('inbox:tick', group => {
  group.setup(async () => {
    await migrateFixture()
    const local = await fixtureDatabase()
    db = local.db

    return local.close
  })

  test('closes the tickets the fixture config finds inactive, once', async ({ assert }) => {
    const stale = await ticketIdleFor({ days: 3 })
    const fresh = await ticketIdleFor({ days: 0 })

    const first = await run('node', ['ace', 'inbox:tick'], { cwd: fixture })
    const second = await run('node', ['ace', 'inbox:tick'], { cwd: fixture })

    assert.deepInclude(await ticketRow(stale), {
      status: 'closed',
      close_reason: 'inactivity',
      version: 1,
    })
    assert.deepInclude(await ticketRow(fresh), { status: 'queued', version: 0 })
    assert.match(first.stdout, /close_inactive: changed [1-9]\d* of/)
    assert.include(second.stdout, 'close_inactive: changed 0 of 0 candidate tickets')
  })
})
