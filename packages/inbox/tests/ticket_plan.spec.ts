import { test } from '@japa/runner'
import { DateTime } from 'luxon'

import { holder, plan, planChange, planOpening, questionsFor } from '../src/ticket/plan.ts'
import type { Plan, PlanContext, TicketChange } from '../src/ticket/plan.ts'
import type {
  Actor,
  Attendant,
  AttendantId,
  AttendantRef,
  ConversationId,
  Gesture,
  QueueId,
  TicketId,
  TicketSnapshot,
  TicketState,
} from '../src/types.ts'

// SAFETY: fixture ids only need to be distinct numbers.
const attendantId = (id: number) => id as AttendantId

// SAFETY: fixture ids only need to be distinct numbers.
const queueId = (id: number) => id as QueueId

const support = queueId(1)
const billing = queueId(2)

const ana: Attendant = { kind: 'human', id: attendantId(1), userId: 101, active: true }
const bea: Attendant = { kind: 'human', id: attendantId(2), userId: 102, active: true }
const carl: Attendant = { kind: 'human', id: attendantId(3), userId: 103, active: true }
const triage: Attendant = { kind: 'bot', id: attendantId(10), botKey: 'triage', active: true }
const survey: Attendant = { kind: 'bot', id: attendantId(11), botKey: 'survey', active: true }
const automation: Actor = { kind: 'system', source: 'close_inactive' }

const opened = DateTime.fromISO('2026-01-05T09:00:00Z')
const lastActivity = DateTime.fromISO('2026-01-05T09:30:00Z')
const now = DateTime.fromISO('2026-01-05T10:00:00Z')

const memberships: Array<[Attendant, QueueId]> = [
  [ana, support],
  [bea, support],
  [bea, billing],
]

function ref(attendant: Attendant): AttendantRef {
  return { kind: attendant.kind, id: attendant.id }
}

function isMember(attendant: AttendantId, queue: QueueId) {
  return memberships.some(
    ([member, memberQueue]) => member.id === attendant && memberQueue === queue,
  )
}

const context: PlanContext = { now, isMember }

function queued(queue = support): TicketState {
  return { status: 'queued', queueId: queue }
}

function heldBy(attendant: Attendant, queue = support): TicketState {
  return { status: 'in_progress', queueId: queue, assignee: ref(attendant) }
}

function closedBy(attendant: Attendant | null): TicketState {
  return {
    status: 'closed',
    queueId: support,
    assignee: attendant === null ? null : ref(attendant),
    reason: 'manual',
  }
}

function ticket(state: TicketState, overrides: Partial<TicketSnapshot> = {}): TicketSnapshot {
  return {
    // SAFETY: fixture ids only need to be distinct numbers.
    id: 7 as TicketId,
    // SAFETY: fixture ids only need to be distinct numbers.
    conversationId: 70 as ConversationId,
    version: 3,
    state,
    openedAt: opened,
    assignedAt: holder(state)?.kind === 'human' ? opened : null,
    firstResponseAt: null,
    lastActivityAt: lastActivity,
    closedAt: state.status === 'closed' ? lastActivity : null,
    unreadCount: 2,
    botState: {},
    ...overrides,
  }
}

function changed(result: Plan) {
  if (result.outcome !== 'changed')
    throw new Error(`expected a change, got ${JSON.stringify(result)}`)

  return result
}

test.group('plan / assume', () => {
  test('a member takes a queued ticket and stamps the first assignment', ({ assert }) => {
    const before = ticket(queued())
    const result = changed(plan(before, { gesture: 'assume' }, ana, context))

    assert.deepEqual(result.next, { ...before, version: 4, state: heldBy(ana), assignedAt: now })
    assert.deepEqual(result.facts, [
      { fact: 'assignment_changed', from: null, to: ref(ana), via: 'assume' },
    ])
  })

  test('a human takes a ticket back from a bot', ({ assert }) => {
    const before = ticket(heldBy(triage))
    const result = changed(plan(before, { gesture: 'assume' }, ana, context))

    assert.deepEqual(result.next.state, heldBy(ana))
    assert.deepEqual(result.facts, [
      { fact: 'assignment_changed', from: ref(triage), to: ref(ana), via: 'assume' },
    ])
  })

  test('assignedAt keeps the first human assignment', ({ assert }) => {
    const before = ticket(heldBy(triage), { assignedAt: opened })
    const result = changed(plan(before, { gesture: 'assume' }, ana, context))

    assert.equal(result.next.assignedAt, opened)
  })

  test('a bot takes a queued ticket without membership and without stamping assignedAt', ({
    assert,
  }) => {
    const before = ticket(queued())
    const result = changed(plan(before, { gesture: 'assume' }, triage, context))

    assert.deepEqual(result.next.state, heldBy(triage))
    assert.isNull(result.next.assignedAt)
    assert.deepEqual(result.facts, [
      { fact: 'assignment_changed', from: null, to: ref(triage), via: 'assume' },
    ])
  })

  test('a bot takes a ticket from another bot', ({ assert }) => {
    const result = changed(plan(ticket(heldBy(survey)), { gesture: 'assume' }, triage, context))

    assert.deepEqual(result.next.state, heldBy(triage))
  })

  test('assuming a ticket you already hold is unchanged', ({ assert }) => {
    assert.deepEqual(plan(ticket(heldBy(ana)), { gesture: 'assume' }, ana, context), {
      outcome: 'unchanged',
    })
    assert.deepEqual(plan(ticket(heldBy(triage)), { gesture: 'assume' }, triage, context), {
      outcome: 'unchanged',
    })
  })

  test('{reason}')
    .with([
      { reason: 'held_by_other', state: heldBy(bea), actor: ana },
      { reason: 'held_by_other', state: heldBy(ana), actor: triage },
      { reason: 'not_member', state: queued(), actor: carl },
      { reason: 'attendant_inactive', state: queued(), actor: { ...ana, active: false } },
      { reason: 'actor_cannot_hold', state: queued(), actor: automation },
      { reason: 'closed', state: closedBy(null), actor: ana },
    ])
    .run(({ assert }, { reason, state, actor }) => {
      assert.deepEqual(plan(ticket(state), { gesture: 'assume' }, actor, context), {
        outcome: 'rejected',
        reason,
      })
    })
})

test.group('plan / assign', () => {
  test('assigns a queued ticket to a member', ({ assert }) => {
    const before = ticket(queued())
    const result = changed(plan(before, { gesture: 'assign', to: bea.id }, automation, context))

    assert.deepEqual(result.next, { ...before, version: 4, state: heldBy(bea), assignedAt: now })
    assert.deepEqual(result.facts, [
      { fact: 'assignment_changed', from: null, to: ref(bea), via: 'assign' },
    ])
  })

  test('reassigns a ticket another human holds', ({ assert }) => {
    const result = changed(
      plan(ticket(heldBy(ana)), { gesture: 'assign', to: bea.id }, carl, context),
    )

    assert.deepEqual(result.next.state, heldBy(bea))
    assert.deepEqual(result.facts, [
      { fact: 'assignment_changed', from: ref(ana), to: ref(bea), via: 'assign' },
    ])
  })

  test('assigns a queued ticket to a bot that is no queue member', ({ assert }) => {
    const before = ticket(queued())

    const result = changed(
      plan(before, { gesture: 'assign', to: triage.id }, automation, {
        ...context,
        target: { ...ref(triage), active: true },
      }),
    )

    assert.deepEqual(result.next, { ...before, version: 4, state: heldBy(triage) })
    assert.deepEqual(result.facts, [
      { fact: 'assignment_changed', from: null, to: ref(triage), via: 'assign' },
    ])
  })

  test('assigning the current holder is unchanged', ({ assert }) => {
    assert.deepEqual(plan(ticket(heldBy(ana)), { gesture: 'assign', to: ana.id }, bea, context), {
      outcome: 'unchanged',
    })
  })

  test('{reason}')
    .with([
      { reason: 'not_member', state: queued(), target: { ...ref(carl), active: true } },
      { reason: 'attendant_inactive', state: queued(), target: { ...ref(bea), active: false } },
      { reason: 'closed', state: closedBy(ana), target: { ...ref(bea), active: true } },
    ])
    .run(({ assert }, { reason, state, target }) => {
      const result = plan(ticket(state), { gesture: 'assign', to: target.id }, automation, {
        ...context,
        target,
      })

      assert.deepEqual(result, { outcome: 'rejected', reason })
    })
})

test.group('plan / transfer', () => {
  test('moves a queued ticket to another queue', ({ assert }) => {
    const before = ticket(queued())

    const result = changed(
      plan(before, { gesture: 'transfer', queueId: billing }, automation, context),
    )

    assert.deepEqual(result.next, { ...before, version: 4, state: queued(billing) })
    assert.deepEqual(result.facts, [{ fact: 'queue_changed', from: support, to: billing }])
  })

  test('hands a ticket to a member of the new queue', ({ assert }) => {
    const result = changed(
      plan(
        ticket(heldBy(ana)),
        { gesture: 'transfer', queueId: billing, to: bea.id },
        ana,
        context,
      ),
    )

    assert.deepEqual(result.next.state, heldBy(bea, billing))
    assert.deepEqual(result.facts, [
      { fact: 'queue_changed', from: support, to: billing },
      { fact: 'assignment_changed', from: ref(ana), to: ref(bea), via: 'transfer' },
    ])
  })

  test('without `to`, the ticket waits unassigned in the new queue', ({ assert }) => {
    const result = changed(
      plan(ticket(heldBy(ana)), { gesture: 'transfer', queueId: billing }, ana, context),
    )

    assert.deepEqual(result.next.state, queued(billing))
    assert.deepEqual(result.facts, [
      { fact: 'queue_changed', from: support, to: billing },
      { fact: 'assignment_changed', from: ref(ana), to: null, via: 'transfer' },
    ])
  })

  test('a transfer to where the ticket already is is unchanged', ({ assert }) => {
    assert.deepEqual(
      plan(ticket(queued()), { gesture: 'transfer', queueId: support }, automation, context),
      { outcome: 'unchanged' },
    )
    assert.deepEqual(
      plan(
        ticket(heldBy(ana)),
        { gesture: 'transfer', queueId: support, to: ana.id },
        ana,
        context,
      ),
      { outcome: 'unchanged' },
    )
  })

  test('the target must be a member of the new queue', ({ assert }) => {
    const result = plan(
      ticket(heldBy(bea)),
      { gesture: 'transfer', queueId: billing, to: ana.id },
      bea,
      context,
    )

    assert.deepEqual(result, { outcome: 'rejected', reason: 'not_member' })
  })
})

test.group('plan / return', () => {
  test('puts a held ticket back in its queue, unassigned', ({ assert }) => {
    const before = ticket(heldBy(ana))
    const result = changed(plan(before, { gesture: 'return' }, ana, context))

    assert.deepEqual(result.next, { ...before, version: 4, state: queued() })
    assert.deepEqual(result.facts, [
      { fact: 'assignment_changed', from: ref(ana), to: null, via: 'return' },
    ])
  })

  test('returning a queued ticket is unchanged', ({ assert }) => {
    assert.deepEqual(plan(ticket(queued()), { gesture: 'return' }, ana, context), {
      outcome: 'unchanged',
    })
  })
})

test.group('plan / close', () => {
  test('closes a held ticket and keeps its assignee', ({ assert }) => {
    const before = ticket(heldBy(ana))

    const result = changed(
      plan(before, { gesture: 'close', reason: 'inactivity' }, automation, context),
    )

    assert.deepEqual(result.next, {
      ...before,
      version: 4,
      state: { status: 'closed', queueId: support, assignee: ref(ana), reason: 'inactivity' },
      closedAt: now,
    })
    assert.deepEqual(result.facts, [{ fact: 'closed', reason: 'inactivity' }])
  })

  test('closes a queued ticket with nobody assigned', ({ assert }) => {
    const result = changed(
      plan(ticket(queued()), { gesture: 'close', reason: 'manual' }, ana, context),
    )

    assert.deepEqual(result.next.state, closedBy(null))
    assert.deepEqual(result.facts, [{ fact: 'closed', reason: 'manual' }])
  })

  test('closing a closed ticket is rejected already_closed', ({ assert }) => {
    assert.deepEqual(
      plan(ticket(closedBy(ana)), { gesture: 'close', reason: 'manual' }, ana, context),
      { outcome: 'rejected', reason: 'already_closed' },
    )
  })

  test('every other change on a closed ticket is rejected closed: {change.gesture}')
    .with<Array<{ change: TicketChange; actor: Actor }>>([
      { change: { gesture: 'assume' }, actor: ana },
      { change: { gesture: 'assign', to: bea.id }, actor: ana },
      { change: { gesture: 'transfer', queueId: billing }, actor: ana },
      { change: { gesture: 'return' }, actor: ana },
      { change: { gesture: 'reply', at: now }, actor: ana },
      { change: { gesture: 'inbound', sentAt: now }, actor: automation },
      { change: { gesture: 'bot_state', state: { step: 2 } }, actor: triage },
    ])
    .run(({ assert }, { change, actor }) => {
      assert.deepEqual(planChange(ticket(closedBy(ana)), change, actor, context), {
        outcome: 'rejected',
        reason: 'closed',
      })
    })
})

test.group('planChange / reply', () => {
  test('a member replying to a queued ticket assumes it', ({ assert }) => {
    const before = ticket(queued())
    const result = changed(planChange(before, { gesture: 'reply', at: now }, ana, context))

    assert.deepEqual(result.next, {
      ...before,
      version: 4,
      state: heldBy(ana),
      assignedAt: now,
      firstResponseAt: now,
      lastActivityAt: now,
      unreadCount: 0,
    })
    assert.deepEqual(result.facts, [
      { fact: 'assignment_changed', from: null, to: ref(ana), via: 'reply' },
    ])
  })

  test('a member replying to a ticket a bot holds takes it over', ({ assert }) => {
    const before = ticket(heldBy(triage))
    const result = changed(planChange(before, { gesture: 'reply', at: now }, ana, context))

    assert.deepEqual(result.next.state, heldBy(ana))
    assert.equal(result.next.unreadCount, 0)
    assert.deepEqual(result.facts, [
      { fact: 'assignment_changed', from: ref(triage), to: ref(ana), via: 'reply' },
    ])
  })

  test('the assignee replying only moves the counters', ({ assert }) => {
    const before = ticket(heldBy(ana))
    const result = changed(planChange(before, { gesture: 'reply', at: now }, ana, context))

    assert.deepEqual(result.next, {
      ...before,
      version: 4,
      firstResponseAt: now,
      lastActivityAt: now,
      unreadCount: 0,
    })
    assert.deepEqual(result.facts, [])
  })

  test('firstResponseAt keeps the first reply', ({ assert }) => {
    const before = ticket(heldBy(ana), { firstResponseAt: lastActivity })
    const result = changed(planChange(before, { gesture: 'reply', at: now }, ana, context))

    assert.equal(result.next.firstResponseAt, lastActivity)
  })

  test('a bot reply counts as the first response but leaves unread alone', ({ assert }) => {
    const before = ticket(heldBy(triage))
    const result = changed(planChange(before, { gesture: 'reply', at: now }, triage, context))

    assert.deepEqual(result.next, {
      ...before,
      version: 4,
      firstResponseAt: now,
      lastActivityAt: now,
    })
  })

  test('a reply older than the last activity leaves it in place', ({ assert }) => {
    const before = ticket(heldBy(ana))
    const result = changed(planChange(before, { gesture: 'reply', at: opened }, ana, context))

    assert.equal(result.next.lastActivityAt, lastActivity)
  })

  test('a bot reply that moves no counter is unchanged', ({ assert }) => {
    const before = ticket(heldBy(triage), { firstResponseAt: opened })

    assert.deepEqual(planChange(before, { gesture: 'reply', at: opened }, triage, context), {
      outcome: 'unchanged',
    })
  })

  test('{reason}: {label}')
    .with([
      { reason: 'not_assignee', label: 'someone else holds it', state: heldBy(ana), actor: bea },
      { reason: 'not_assignee', label: 'a bot on a queued ticket', state: queued(), actor: triage },
      {
        reason: 'not_assignee',
        label: 'a bot on another bot',
        state: heldBy(survey),
        actor: triage,
      },
      {
        reason: 'not_member',
        label: 'a non-member on a bot ticket',
        state: heldBy(triage),
        actor: carl,
      },
      { reason: 'not_assignee', label: 'a system actor', state: heldBy(ana), actor: automation },
      {
        reason: 'not_member',
        label: 'a non-member on a queued ticket',
        state: queued(),
        actor: carl,
      },
      {
        reason: 'attendant_inactive',
        label: 'a deactivated assignee',
        state: heldBy(ana),
        actor: { ...ana, active: false },
      },
    ])
    .run(({ assert }, { reason, state, actor }) => {
      assert.deepEqual(planChange(ticket(state), { gesture: 'reply', at: now }, actor, context), {
        outcome: 'rejected',
        reason,
      })
    })
})

test.group('planChange / inbound', () => {
  test('bumps unread and the last activity on an open ticket', ({ assert }) => {
    const before = ticket(queued())

    const result = changed(
      planChange(before, { gesture: 'inbound', sentAt: now }, automation, context),
    )

    assert.deepEqual(result.next, { ...before, version: 4, unreadCount: 3, lastActivityAt: now })
    assert.deepEqual(result.facts, [])
  })

  test('a message sent before the last activity still counts as unread', ({ assert }) => {
    const result = changed(
      planChange(ticket(heldBy(ana)), { gesture: 'inbound', sentAt: opened }, automation, context),
    )

    assert.equal(result.next.unreadCount, 3)
    assert.equal(result.next.lastActivityAt, lastActivity)
  })
})

test.group('planChange / bot_state', () => {
  test('stores the state of the bot that holds the ticket, beside other bots', ({ assert }) => {
    const before = ticket(heldBy(triage), { botState: { [survey.id]: { answered: true } } })

    const result = changed(
      planChange(before, { gesture: 'bot_state', state: { asked: true } }, triage, context),
    )

    assert.deepEqual(result.next, {
      ...before,
      version: 4,
      botState: { [survey.id]: { answered: true }, [triage.id]: { asked: true } },
    })
    assert.deepEqual(result.facts, [])
  })

  test('storing the same state is unchanged', ({ assert }) => {
    const state = { asked: true }
    const before = ticket(heldBy(triage), { botState: { [triage.id]: state } })

    assert.deepEqual(planChange(before, { gesture: 'bot_state', state }, triage, context), {
      outcome: 'unchanged',
    })
  })

  test('not_assignee: {label}')
    .with([
      { label: 'another bot holds it', state: heldBy(survey), actor: triage },
      { label: 'a human holds it', state: heldBy(ana), actor: triage },
      { label: 'nobody holds it', state: queued(), actor: triage },
      { label: 'the actor is a human', state: heldBy(ana), actor: ana },
    ])
    .run(({ assert }, { state, actor }) => {
      const result = planChange(ticket(state), { gesture: 'bot_state', state: 1 }, actor, context)

      assert.deepEqual(result, { outcome: 'rejected', reason: 'not_assignee' })
    })

  test('a deactivated bot is rejected attendant_inactive', ({ assert }) => {
    const result = planChange(
      ticket(heldBy(triage)),
      { gesture: 'bot_state', state: 1 },
      { ...triage, active: false },
      context,
    )

    assert.deepEqual(result, { outcome: 'rejected', reason: 'attendant_inactive' })
  })
})

test.group('questionsFor', () => {
  test('names every membership plan consults: {change.gesture} by {actor.kind}')
    .with<Array<{ state: TicketState; change: Gesture | TicketChange; actor: Actor }>>([
      { state: queued(), change: { gesture: 'assume' }, actor: ana },
      { state: queued(), change: { gesture: 'assume' }, actor: carl },
      { state: queued(), change: { gesture: 'assume' }, actor: triage },
      { state: heldBy(ana), change: { gesture: 'assign', to: bea.id }, actor: automation },
      { state: queued(), change: { gesture: 'assign', to: carl.id }, actor: automation },
      {
        state: heldBy(ana),
        change: { gesture: 'transfer', queueId: billing, to: bea.id },
        actor: ana,
      },
      {
        state: heldBy(bea),
        change: { gesture: 'transfer', queueId: billing, to: ana.id },
        actor: bea,
      },
      { state: queued(), change: { gesture: 'reply', at: now }, actor: ana },
      { state: queued(), change: { gesture: 'reply', at: now }, actor: carl },
      { state: heldBy(ana), change: { gesture: 'reply', at: now }, actor: ana },
      { state: heldBy(triage), change: { gesture: 'reply', at: now }, actor: ana },
      { state: heldBy(triage), change: { gesture: 'reply', at: now }, actor: carl },
    ])
    .run(({ assert }, { state, change, actor }) => {
      const before = ticket(state)
      const asked = questionsFor(before, change, actor)

      const answered: PlanContext = {
        now,
        isMember: (attendant, queue) => {
          if (!asked.some(([a, q]) => a === attendant && q === queue)) {
            throw new Error(`plan consulted (${attendant}, ${queue}) without asking`)
          }

          return isMember(attendant, queue)
        },
      }

      assert.deepEqual(
        planChange(before, change, actor, answered),
        planChange(before, change, actor, context),
      )
    })
})

test.group('holder', () => {
  test('is the assignee while in progress and nobody otherwise', ({ assert }) => {
    assert.deepEqual(holder(heldBy(ana)), ref(ana))
    assert.isNull(holder(queued()))
    assert.isNull(holder(closedBy(ana)))
  })
})

test.group('planOpening', () => {
  test('opens a queued ticket and records where it came from', ({ assert }) => {
    assert.deepEqual(planOpening(billing, 'inbound'), {
      state: queued(billing),
      facts: [{ fact: 'opened', queueId: billing, origin: 'inbound' }],
    })
  })
})
