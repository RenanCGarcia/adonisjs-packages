import { test } from '@japa/runner'

import type { ApplyResult, TicketSnapshot } from '../src/types.ts'
import { agent, bootFixture, host, openTicket, queue } from './helpers/host.ts'

interface TicketEvent {
  type: string
  data: object
  actor_kind: string
  actor_id: number | null
  actor_source: string | null
}

function database() {
  return host().db
}

/**
 * Who holds the ticket after the gesture, when it changed or kept it.
 */
function holderAfter(result: ApplyResult) {
  return result.outcome !== 'rejected' && result.ticket.state.status === 'in_progress'
    ? result.ticket.state.assignee
    : null
}

function reasonOf(result: ApplyResult) {
  return result.outcome === 'rejected' ? result.reason : null
}

async function eventsOf(ticket: TicketSnapshot) {
  const rows = await database()
    .from('inbox_ticket_events')
    .where('ticket_id', ticket.id)
    .orderBy('id')
    .select('type', 'data', 'actor_kind', 'actor_id', 'actor_source')

  return rows.map((row): TicketEvent => ({
    type: row.type,
    data: JSON.parse(row.data),
    actor_kind: row.actor_kind,
    actor_id: row.actor_id,
    actor_source: row.actor_source,
  }))
}

function rowOf(ticket: TicketSnapshot) {
  return database().from('inbox_tickets').where('id', ticket.id).first()
}

test.group('tickets', group => {
  bootFixture(group)

  test('assume, transfer, return and close each land as ticket events', async ({ assert }) => {
    const ana = await agent()
    const bea = await agent()
    const support = await queue(ana)
    const billing = await queue(bea)
    const ticket = await openTicket(ana, support)
    const anaId = ana.me.id
    const beaId = bea.me.id

    const assumed = await ana.assume(ticket)
    const transfer = { gesture: 'transfer', queueId: billing, to: beaId } as const
    const transferred = await ana.apply(ticket, transfer)
    const returned = await bea.apply(ticket, { gesture: 'return' })
    const closed = await bea.apply(ticket, { gesture: 'close', reason: 'manual' })

    assert.deepEqual(
      [assumed, transferred, returned, closed].map(result => result.outcome),
      ['changed', 'changed', 'changed', 'changed'],
    )
    assert.deepEqual(holderAfter(assumed), { kind: 'human', id: anaId })
    assert.deepEqual(holderAfter(transferred), { kind: 'human', id: beaId })
    assert.deepEqual(closed.outcome === 'changed' && closed.ticket.state, {
      status: 'closed',
      queueId: billing,
      assignee: null,
      reason: 'manual',
    })
    assert.deepEqual(await eventsOf(ticket), [
      {
        type: 'opened',
        data: { fact: 'opened', queueId: support, origin: 'outbound' },
        actor_kind: 'human',
        actor_id: anaId,
        actor_source: null,
      },
      {
        type: 'assignment_changed',
        data: {
          fact: 'assignment_changed',
          from: null,
          to: { kind: 'human', id: anaId },
          via: 'assume',
        },
        actor_kind: 'human',
        actor_id: anaId,
        actor_source: null,
      },
      {
        type: 'queue_changed',
        data: { fact: 'queue_changed', from: support, to: billing },
        actor_kind: 'human',
        actor_id: anaId,
        actor_source: null,
      },
      {
        type: 'assignment_changed',
        data: {
          fact: 'assignment_changed',
          from: { kind: 'human', id: anaId },
          to: { kind: 'human', id: beaId },
          via: 'transfer',
        },
        actor_kind: 'human',
        actor_id: anaId,
        actor_source: null,
      },
      {
        type: 'assignment_changed',
        data: {
          fact: 'assignment_changed',
          from: { kind: 'human', id: beaId },
          to: null,
          via: 'return',
        },
        actor_kind: 'human',
        actor_id: beaId,
        actor_source: null,
      },
      {
        type: 'closed',
        data: { fact: 'closed', reason: 'manual' },
        actor_kind: 'human',
        actor_id: beaId,
        actor_source: null,
      },
    ])
  })

  test('a repeated gesture is unchanged and records nothing', async ({ assert }) => {
    const ana = await agent()
    const ticket = await openTicket(ana, await queue(ana))

    await ana.assume(ticket)
    const again = await ana.assume(ticket)

    assert.equal(again.outcome, 'unchanged')
    assert.lengthOf(await eventsOf(ticket), 2)
  })

  test('a human takes a ticket back from the triage bot', async ({ assert }) => {
    const ana = await agent()
    const ticket = await openTicket(ana, await queue(ana))
    const triage = await host().inbox.attendants.bot('triage')

    const toBot = await ana.apply(ticket, { gesture: 'assign', to: triage.id })
    const takenBack = await ana.assume(ticket)

    assert.equal(holderAfter(toBot)?.kind, 'bot')
    assert.equal(holderAfter(takenBack)?.kind, 'human')
  })

  test('agents assuming at once leave exactly one holder', async ({ assert }) => {
    const agents = await Promise.all([agent(), agent(), agent(), agent(), agent()])
    const support = await queue(...agents)

    const tickets = [
      await openTicket(agents[0]!, support),
      await openTicket(agents[0]!, support),
      await openTicket(agents[0]!, support),
    ]

    for (const ticket of tickets) {
      const results = await Promise.all(agents.map(racer => racer.assume(ticket)))
      const [winner, ...others] = results.filter(result => result.outcome === 'changed')

      assert.lengthOf(others, 0)
      assert.equal((await rowOf(ticket))?.assignee_id, winner && holderAfter(winner)?.id)
      assert.sameMembers(
        results.filter(result => result.outcome !== 'changed').map(reasonOf),
        Array.from({ length: agents.length - 1 }, () => 'held_by_other'),
      )
      assert.lengthOf(
        (await eventsOf(ticket)).filter(event => event.type === 'assignment_changed'),
        1,
      )
    }
  })

  test('authorize vetoes closing a ticket a colleague holds', async ({ assert }) => {
    const ana = await agent()
    const bea = await agent()
    const ticket = await openTicket(ana, await queue(ana, bea))

    await ana.assume(ticket)
    const vetoed = await bea.apply(ticket, { gesture: 'close', reason: 'manual' })
    const ownClose = await ana.apply(ticket, { gesture: 'close', reason: 'manual' })

    assert.deepEqual([vetoed.outcome, reasonOf(vetoed)], ['rejected', 'forbidden'])
    assert.equal(ownClose.outcome, 'changed')
  })

  test('only the holder clears the unread count', async ({ assert }) => {
    const ana = await agent()
    const bea = await agent()
    const ticket = await openTicket(ana, await queue(ana, bea))

    await ana.assume(ticket)
    await database().from('inbox_tickets').where('id', ticket.id).update({ unread_count: 3 })

    await host().inbox.tickets.markRead(ticket.id, bea.me)
    const afterColleague = (await rowOf(ticket))?.unread_count

    await host().inbox.tickets.markRead(ticket.id, ana.me)

    assert.equal(afterColleague, 3)
    assert.equal((await rowOf(ticket))?.unread_count, 0)
  })

  test('deactivating an attendant returns its tickets to the queue', async ({ assert }) => {
    const admin = await agent()
    const ana = await agent()
    const support = await queue(ana)
    const tickets = [await openTicket(admin, support), await openTicket(admin, support)]

    for (const ticket of tickets) await ana.assume(ticket)

    await host().inbox.attendants.deactivate(ana.me)

    for (const ticket of tickets) {
      assert.equal((await rowOf(ticket))?.status, 'queued')
      assert.deepInclude((await eventsOf(ticket)).at(-1), {
        type: 'assignment_changed',
        actor_kind: 'system',
        actor_source: 'attendant_deactivated',
      })
      assert.equal(reasonOf(await ana.assume(ticket)), 'attendant_inactive')
    }
  })

  test('removing a member returns its tickets in that queue only', async ({ assert }) => {
    const admin = await agent()
    const carl = await agent()
    const support = await queue(carl)
    const billing = await queue(carl)
    const inSupport = await openTicket(admin, support)
    const inBilling = await openTicket(admin, billing)

    await carl.assume(inSupport)
    await carl.assume(inBilling)

    await host().inbox.queues.removeMember(support, carl.me)

    assert.equal((await rowOf(inSupport))?.status, 'queued')
    assert.equal((await rowOf(inBilling))?.status, 'in_progress')
    assert.equal(reasonOf(await carl.assume(inSupport)), 'not_member')
  })

  test('a conversation has one open ticket, and closing it frees the slot', async ({ assert }) => {
    const ana = await agent()
    const queueId = await queue(ana)
    const ticket = await openTicket(ana, queueId)
    const open = () => host().inbox.tickets.open(ticket.conversationId, queueId, ana.me)

    const reopened = await open()

    const now = '2026-01-05 10:00:00'

    const secondOpen = () =>
      database().table('inbox_tickets').insert({
        conversation_id: ticket.conversationId,
        open_conversation_id: ticket.conversationId,
        queue_id: ticket.state.queueId,
        status: 'queued',
        version: 0,
        bot_state: '{}',
        unread_count: 0,
        opened_at: now,
        last_activity_at: now,
        created_at: now,
      })

    await assert.rejects(secondOpen, /unique constraint.*open_conversation_id/i)

    await ana.apply(ticket, { gesture: 'close', reason: 'manual' })
    const afterClose = await open()

    assert.deepEqual([reopened.opened, reopened.ticket.id], [false, ticket.id])
    assert.equal(afterClose.opened, true)
    assert.notEqual(afterClose.ticket.id, ticket.id)
  })

  test('the database refuses a ticket or attendant row the domain forbids', async ({ assert }) => {
    const ana = await agent()
    const ticket = await openTicket(ana, await queue(ana))
    const tickets = () => database().from('inbox_tickets').where('id', ticket.id)

    await assert.rejects(
      () => tickets().update({ status: 'in_progress' }),
      /check constraint.*inbox_tickets_assignee/i,
    )
    await assert.rejects(
      () => tickets().update({ status: 'closed' }),
      /check constraint.*inbox_tickets_open/i,
    )
    await assert.rejects(
      () =>
        database()
          .table('inbox_attendants')
          .insert({
            kind: 'human',
            user_id: ana.userId + 1_000_000,
            bot_key: 'triage-twin',
            created_at: '2026-01-05 10:00:00',
          }),
      /check constraint.*inbox_attendants_identity/i,
    )

    assert.equal((await rowOf(ticket))?.status, 'queued')
  })
})
