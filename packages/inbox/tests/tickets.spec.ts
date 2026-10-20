import { test } from '@japa/runner'

import {
  agent,
  database,
  openTicket,
  playgroundUrl,
  queue,
  servePlayground,
  type Ticket,
} from './helpers/http.ts'

interface TicketEvent {
  type: string
  data: object
  actor_kind: string
  actor_id: number | null
  actor_source: string | null
}

async function eventsOf(ticket: Ticket) {
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

function rowOf(ticket: Ticket) {
  return database().from('inbox_tickets').where('id', ticket.id).first()
}

test.group('tickets over HTTP', group => {
  servePlayground(group)

  test('assume, transfer, return and close each land as ticket events', async ({ assert }) => {
    const ana = await agent()
    const bea = await agent()
    const support = await queue(ana, ana)
    const billing = await queue(ana, bea)
    const ticket = await openTicket(ana, support)

    const assumed = await ana.assume(ticket)
    const anaId = assumed.ticket.state.status === 'in_progress' && assumed.ticket.state.assignee.id

    const transferred = await ana.post(`/inbox/tickets/${ticket.id}/transfer`, {
      queueId: billing,
      userId: bea.userId,
    })

    const beaId =
      transferred.ticket.state.status === 'in_progress' && transferred.ticket.state.assignee.id

    const returned = await bea.post(`/inbox/tickets/${ticket.id}/return`)
    const closed = await bea.post(`/inbox/tickets/${ticket.id}/close`, { reason: 'manual' })

    assert.deepEqual(
      [assumed, transferred, returned, closed].map(answer => [answer.status, answer.outcome]),
      [
        [200, 'changed'],
        [200, 'changed'],
        [200, 'changed'],
        [200, 'changed'],
      ],
    )
    assert.deepEqual(closed.ticket.state, {
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
    const ticket = await openTicket(ana, await queue(ana, ana))

    await ana.assume(ticket)
    const again = await ana.assume(ticket)

    assert.equal(again.outcome, 'unchanged')
    assert.lengthOf(await eventsOf(ticket), 2)
  })

  test('a human takes a ticket back from the triage bot', async ({ assert }) => {
    const ana = await agent()
    const ticket = await openTicket(ana, await queue(ana, ana))

    const toBot = await ana.post(`/inbox/tickets/${ticket.id}/assign`, { bot: 'triage' })
    const takenBack = await ana.assume(ticket)

    assert.equal(
      toBot.ticket.state.status === 'in_progress' && toBot.ticket.state.assignee.kind,
      'bot',
    )
    assert.equal(
      takenBack.ticket.state.status === 'in_progress' && takenBack.ticket.state.assignee.kind,
      'human',
    )
  })

  test('agents assuming at once leave exactly one holder', async ({ assert }) => {
    const agents = await Promise.all([agent(), agent(), agent(), agent(), agent()])
    const support = await queue(agents[0]!, ...agents)

    const tickets = [
      await openTicket(agents[0]!, support),
      await openTicket(agents[0]!, support),
      await openTicket(agents[0]!, support),
    ]

    for (const ticket of tickets) {
      // Open one keep-alive socket per racer first, so the assumes reach the server together.
      await Promise.all(agents.map(() => fetch(playgroundUrl()).then(response => response.text())))

      const answers = await Promise.all(agents.map(racer => racer.assume(ticket)))
      const [winner, ...others] = answers.filter(answer => answer.status === 200)

      const holder =
        winner?.ticket.state.status === 'in_progress' && winner.ticket.state.assignee.id

      assert.lengthOf(others, 0)
      assert.equal((await rowOf(ticket))?.assignee_id, holder)
      assert.sameMembers(
        answers.filter(answer => answer.status !== 200).map(answer => answer.reason),
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
    const ticket = await openTicket(ana, await queue(ana, ana, bea))

    await ana.assume(ticket)
    const vetoed = await bea.post(`/inbox/tickets/${ticket.id}/close`, { reason: 'manual' })
    const ownClose = await ana.post(`/inbox/tickets/${ticket.id}/close`, { reason: 'manual' })

    assert.deepEqual([vetoed.status, vetoed.reason], [409, 'forbidden'])
    assert.equal(ownClose.outcome, 'changed')
  })

  test('only the holder clears the unread count', async ({ assert }) => {
    const ana = await agent()
    const bea = await agent()
    const ticket = await openTicket(ana, await queue(ana, ana, bea))

    await ana.assume(ticket)
    await database().from('inbox_tickets').where('id', ticket.id).update({ unread_count: 3 })

    await bea.post(`/inbox/tickets/${ticket.id}/read`)
    const afterColleague = (await rowOf(ticket))?.unread_count

    await ana.post(`/inbox/tickets/${ticket.id}/read`)

    assert.equal(afterColleague, 3)
    assert.equal((await rowOf(ticket))?.unread_count, 0)
  })

  test('deactivating an attendant returns its tickets to the queue', async ({ assert }) => {
    const admin = await agent()
    const ana = await agent()
    const support = await queue(admin, ana)
    const tickets = [await openTicket(admin, support), await openTicket(admin, support)]

    for (const ticket of tickets) await ana.assume(ticket)

    const deactivated = await admin.post(`/inbox/attendants/${ana.userId}/deactivate`)

    assert.equal(deactivated.status, 204)

    for (const ticket of tickets) {
      assert.equal((await rowOf(ticket))?.status, 'queued')
      assert.deepInclude((await eventsOf(ticket)).at(-1), {
        type: 'assignment_changed',
        actor_kind: 'system',
        actor_source: 'attendant_deactivated',
      })
      assert.equal((await ana.assume(ticket)).reason, 'attendant_inactive')
    }
  })

  test('removing a member returns its tickets in that queue only', async ({ assert }) => {
    const admin = await agent()
    const carl = await agent()
    const support = await queue(admin, carl)
    const billing = await queue(admin, carl)
    const inSupport = await openTicket(admin, support)
    const inBilling = await openTicket(admin, billing)

    await carl.assume(inSupport)
    await carl.assume(inBilling)

    const removed = await admin.del(`/inbox/queues/${support}/members/${carl.userId}`)

    assert.equal(removed.status, 204)
    assert.equal((await rowOf(inSupport))?.status, 'queued')
    assert.equal((await rowOf(inBilling))?.status, 'in_progress')
    assert.equal((await carl.assume(inSupport)).reason, 'not_member')
  })

  test('a conversation has one open ticket, and closing it frees the slot', async ({ assert }) => {
    const ana = await agent()
    const ticket = await openTicket(ana, await queue(ana, ana))
    const conversationId = Number((await rowOf(ticket))?.conversation_id)

    const reopened = await ana.post(`/inbox/conversations/${conversationId}/tickets`)

    const now = '2026-01-05 10:00:00'

    const secondOpen = () =>
      database().table('inbox_tickets').insert({
        conversation_id: conversationId,
        open_conversation_id: conversationId,
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

    await ana.post(`/inbox/tickets/${ticket.id}/close`, { reason: 'manual' })
    const afterClose = await ana.post(`/inbox/conversations/${conversationId}/tickets`)

    assert.deepEqual([reopened.opened, reopened.ticket.id], [false, ticket.id])
    assert.equal(afterClose.opened, true)
    assert.notEqual(afterClose.ticket.id, ticket.id)
  })

  test('the database refuses a ticket or attendant row the domain forbids', async ({ assert }) => {
    const ana = await agent()
    const ticket = await openTicket(ana, await queue(ana, ana))
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
