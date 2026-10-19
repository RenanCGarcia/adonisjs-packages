import { test } from '@japa/runner'
import { DateTime } from 'luxon'

import { toAttendant } from '../src/attendant/row.ts'
import { InboxError } from '../src/errors.ts'
import { toRow, toSnapshot } from '../src/ticket/row.ts'
import type {
  AttendantId,
  ConversationId,
  QueueId,
  TicketId,
  TicketSnapshot,
  TicketState,
} from '../src/types.ts'

// SAFETY: fixture ids only need to be distinct numbers.
const ticketId = 7 as TicketId

// SAFETY: fixture ids only need to be distinct numbers.
const conversationId = 70 as ConversationId

// SAFETY: fixture ids only need to be distinct numbers.
const support = 1 as QueueId

// SAFETY: fixture ids only need to be distinct numbers.
const ana = 3 as AttendantId

const now = DateTime.fromISO('2026-01-05T10:00:00Z')

const states: Array<{ name: string; state: TicketState }> = [
  { name: 'queued', state: { status: 'queued', queueId: support } },
  {
    name: 'in progress',
    state: { status: 'in_progress', queueId: support, assignee: { kind: 'human', id: ana } },
  },
  {
    name: 'closed with its last assignee',
    state: {
      status: 'closed',
      queueId: support,
      assignee: { kind: 'bot', id: ana },
      reason: 'manual',
    },
  },
  {
    name: 'closed while queued',
    state: { status: 'closed', queueId: support, assignee: null, reason: 'inactivity' },
  },
]

function inboxErrorCode(parse: () => void) {
  try {
    parse()
  } catch (error) {
    if (error instanceof InboxError) return error.code

    throw error
  }

  return null
}

function snapshot(state: TicketState): TicketSnapshot {
  return {
    id: ticketId,
    conversationId,
    version: 4,
    state,
    openedAt: now,
    assignedAt: null,
    firstResponseAt: null,
    lastActivityAt: now,
    closedAt: state.status === 'closed' ? now : null,
    unreadCount: 2,
    botState: { [ana]: { asked: true } },
  }
}

test.group('ticket rows', () => {
  test('a {name} ticket reads back as the snapshot it was written from')
    .with(states)
    .run(({ assert }, { state }) => {
      const written = snapshot(state)

      assert.deepEqual(toSnapshot({ id: ticketId, ...toRow(written) }), written)
    })

  test('an open ticket claims its conversation and a closed one lets go', ({ assert }) => {
    const [queued, inProgress, closed] = states.map(({ state }) => toRow(snapshot(state)))

    assert.equal(queued?.openConversationId, conversationId)
    assert.equal(inProgress?.openConversationId, conversationId)
    assert.isNull(closed?.openConversationId)
  })

  test('a row the CHECK constraints forbid fails to parse with E_INBOX_INVALID_ROW', ({
    assert,
  }) => {
    const row = {
      id: ticketId,
      ...toRow(snapshot(states[0]!.state)),
      status: 'in_progress' as const,
    }

    assert.equal(
      inboxErrorCode(() => toSnapshot(row)),
      'E_INBOX_INVALID_ROW',
    )
  })
})

test.group('attendant rows', () => {
  test('a human row parses to a human and a deactivated one to an inactive attendant', ({
    assert,
  }) => {
    assert.deepEqual(
      toAttendant({ id: ana, kind: 'human', userId: 9, botKey: null, deactivatedAt: null }),
      { kind: 'human', id: ana, userId: 9, active: true },
    )
    assert.deepEqual(
      toAttendant({ id: ana, kind: 'bot', userId: null, botKey: 'triage', deactivatedAt: now }),
      { kind: 'bot', id: ana, botKey: 'triage', active: false },
    )
  })

  test('a human without a user id fails to parse with E_INBOX_INVALID_ROW', ({ assert }) => {
    const row = {
      id: ana,
      kind: 'human',
      userId: null,
      botKey: 'triage',
      deactivatedAt: null,
    } as const

    assert.equal(
      inboxErrorCode(() => toAttendant(row)),
      'E_INBOX_INVALID_ROW',
    )
  })
})
