import { test } from '@japa/runner'
import { DateTime } from 'luxon'

import * as inbox from '../index.ts'
import type { Attendant, AttendantId, ConversationId, QueueId, TicketId } from '../index.ts'

test.group('public api', () => {
  test('the root leaves the internal ticket changes out', ({ assert }) => {
    assert.notProperty(inbox, 'planChange')
    assert.notProperty(inbox, 'questionsFor')
  })

  test('plan only types public gestures', ({ assert }) => {
    const now = DateTime.fromISO('2026-01-05T10:00:00Z')
    // SAFETY: fixture ids only need to be distinct numbers.
    const ana: Attendant = { kind: 'human', id: 1 as AttendantId, userId: 1, active: true }

    const ticket = {
      // SAFETY: fixture ids only need to be distinct numbers.
      id: 1 as TicketId,
      // SAFETY: fixture ids only need to be distinct numbers.
      conversationId: 1 as ConversationId,
      version: 0,
      // SAFETY: fixture ids only need to be distinct numbers.
      state: { status: 'queued', queueId: 1 as QueueId } as const,
      openedAt: now,
      assignedAt: null,
      firstResponseAt: null,
      lastActivityAt: now,
      closedAt: null,
      unreadCount: 0,
      botState: {},
    }

    // @ts-expect-error `reply` is an internal change, so a public caller can't forge one.
    const forged = inbox.plan(ticket, { gesture: 'reply', at: now }, ana, {
      now,
      isMember: () => true,
    })

    assert.exists(forged)
  })
})
