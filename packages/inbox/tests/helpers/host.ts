import { randomUUID } from 'node:crypto'

import type { ApplicationService } from '@adonisjs/core/types'
import type { Database } from '@adonisjs/lucid/database'
import type { Group } from '@japa/runner/core'

import type { Inbox } from '../../src/inbox.ts'
import type { Gesture, QueueId, TicketId } from '../../src/types.ts'
import { boot, fixtureConfig, migrateFixture } from './app.ts'

let app: ApplicationService
let inbox: Inbox
let db: Database

/**
 * Migrates the fixture and boots it in this process for the group, with its own
 * `config/inbox.ts`, as the host's controllers and jobs would use the inbox.
 */
export function bootFixture(group: Group) {
  group.setup(async () => {
    await migrateFixture()
    app = await boot(await fixtureConfig())
    inbox = await app.container.make('inbox')
    db = await app.container.make('lucid.db')

    return () => app.terminate()
  })
}

export function host() {
  return { inbox, db }
}

/**
 * A host user working as an attendant.
 */
export async function agent() {
  const userId = Math.floor(Math.random() * 1e9)
  const me = await inbox.attendants.forUser(userId)

  const apply = (ticket: { id: TicketId }, gesture: Gesture) =>
    inbox.tickets.apply(ticket.id, gesture, me)

  return {
    userId,
    me,
    apply,
    assume: (ticket: { id: TicketId }) => apply(ticket, { gesture: 'assume' }),
  }
}

export type Agent = Awaited<ReturnType<typeof agent>>

export async function queue(...members: Agent[]) {
  const { id } = await (await inbox.model('queue')).create({ name: `queue-${randomUUID()}` })

  for (const member of members) await inbox.queues.addMember(id, member.me)

  return id
}

export async function channelOn(queueId: QueueId, provider = 'fake') {
  const webhookToken = randomUUID()
  const secret: string = randomUUID()

  const { id } = await (
    await inbox.model('channel')
  ).create({
    provider,
    name: 'fixture',
    defaultQueueId: queueId,
    webhookToken,
    credentials: { secret },
  })

  return { id, webhookToken, secret }
}

/**
 * An agent reaching out to a new contact, which opens a ticket in the channel's queue.
 */
export async function openTicket(by: Agent, queueId: QueueId) {
  const channel = await channelOn(queueId)
  const Contact = await inbox.model('contact')
  const Conversation = await inbox.model('conversation')
  const contact = await Contact.create({ channelId: channel.id, address: `+55${randomUUID()}` })

  const conversation = await Conversation.create({
    channelId: channel.id,
    contactId: contact.id,
  })

  const { ticket } = await inbox.tickets.open(conversation.id, queueId, by.me)

  return ticket
}
