import type { DateTime } from 'luxon'

import type {
  Actor,
  Attendant,
  AttendantId,
  AttendantRef,
  Gesture,
  GestureName,
  JsonValue,
  QueueId,
  Rejection,
  TicketFact,
  TicketSnapshot,
  TicketState,
} from '../types.ts'

/**
 * `reply`, `inbound` and `bot_state` come from sends, ingest and bot turns, so counters, the
 * implicit assume and bot state follow the same rules and land in the same compare-and-swap.
 * The package root doesn't export them, so a public caller can't forge one.
 */
export type TicketChange =
  | Gesture
  | { gesture: 'reply'; at: DateTime }
  | { gesture: 'inbound'; sentAt: DateTime }
  | { gesture: 'bot_state'; state: JsonValue }

/**
 * What `plan` needs but can't read itself. The caller loads the pairs `questionsFor` names.
 */
export interface PlanContext {
  now: DateTime
  isMember: (attendant: AttendantId, queue: QueueId) => boolean
  /**
   * The attendant an `assign` or a `transfer` hands the ticket to. Defaults to an active human.
   */
  target?: AttendantRef & { active: boolean }
}

export type Plan =
  | { outcome: 'changed'; next: TicketSnapshot; facts: TicketFact[] }
  | { outcome: 'unchanged' }
  | { outcome: 'rejected'; reason: Rejection }

interface KindRule {
  needsMembership: boolean
  stampsAssignedAt: boolean
  replyClearsUnread: boolean
  replyCountsAsFirstResponse: boolean
}

export const KIND_RULES = {
  human: {
    needsMembership: true,
    stampsAssignedAt: true,
    replyClearsUnread: true,
    replyCountsAsFirstResponse: true,
  },
  bot: {
    needsMembership: false,
    stampsAssignedAt: false,
    replyClearsUnread: false,
    replyCountsAsFirstResponse: true,
  },
} as const satisfies Record<AttendantRef['kind'], KindRule>

type OpenState = Exclude<TicketState, { status: 'closed' }>

/**
 * The ticket state machine. Status, queue and assignee move like this:
 *
 * - `assume`: queued, or held by a bot, goes in progress with the actor, who must be an
 *   attendant. Held by another human is rejected `held_by_other`.
 * - `assign`: open goes in progress with `to`. A human target must be a member of the queue.
 * - `transfer`: open moves to `queueId`, in progress with `to` when given, queued otherwise.
 * - `return`: in progress goes back to queued, unassigned.
 * - `close`: open goes closed with `reason`, keeping the assignee.
 * - Any change on a closed ticket is rejected `closed`, and `close` is rejected `already_closed`.
 *
 * `assignedAt` is stamped on the first human assignment only and `closedAt` on close. A change
 * whose target is the current state comes back `unchanged`, never as a second set of facts.
 */
export function plan(
  ticket: TicketSnapshot,
  gesture: Gesture,
  actor: Actor,
  context: PlanContext,
): Plan {
  return planChange(ticket, gesture, actor, context)
}

/**
 * `plan` over the internal changes too:
 *
 * - `reply`: a human replying to a queued ticket assumes it. The assignee replying only moves the
 *   counters. Anyone else is rejected `not_assignee`.
 * - `inbound`: bumps the unread count and the last activity.
 * - `bot_state`: stores the state of the bot that holds the ticket. Any other actor is rejected
 *   `not_assignee`.
 */
export function planChange(
  ticket: TicketSnapshot,
  change: TicketChange,
  actor: Actor,
  context: PlanContext,
): Plan {
  const { state } = ticket

  if (state.status === 'closed') {
    return rejected(change.gesture === 'close' ? 'already_closed' : 'closed')
  }

  switch (change.gesture) {
    case 'assume':
      return assume(ticket, state, actor, context)
    case 'assign':
      return handTo(ticket, state.queueId, change.to, 'assign', context)
    case 'transfer':
      return change.to === undefined
        ? transition(ticket, { status: 'queued', queueId: change.queueId }, 'transfer', context)
        : handTo(ticket, change.queueId, change.to, 'transfer', context)
    case 'return':
      return transition(ticket, { status: 'queued', queueId: state.queueId }, 'return', context)
    case 'close':
      return transition(
        ticket,
        {
          status: 'closed',
          queueId: state.queueId,
          assignee: holder(state),
          reason: change.reason,
        },
        'close',
        context,
      )
    case 'reply':
      return reply(ticket, state, actor, change.at, context)
    case 'inbound':
      return settle(
        ticket,
        {
          ...ticket,
          unreadCount: ticket.unreadCount + 1,
          lastActivityAt: later(ticket.lastActivityAt, change.sentAt),
        },
        [],
      )
    case 'bot_state':
      return storeBotState(ticket, state, actor, change.state)
    default: {
      const unhandled: never = change

      return unhandled
    }
  }
}

/**
 * The (attendant, queue) membership pairs `planChange` may consult for this change.
 */
export function questionsFor(
  ticket: TicketSnapshot,
  change: TicketChange,
  actor: Actor,
): Array<[AttendantId, QueueId]> {
  const { queueId } = ticket.state
  const actorNeedsMembership = actor.kind !== 'system' && KIND_RULES[actor.kind].needsMembership

  switch (change.gesture) {
    case 'assume':
      return actorNeedsMembership ? [[actor.id, queueId]] : []
    case 'reply':
      return actorNeedsMembership && ticket.state.status === 'queued' ? [[actor.id, queueId]] : []
    case 'assign':
      return [[change.to, queueId]]
    case 'transfer':
      return change.to === undefined ? [] : [[change.to, change.queueId]]
    case 'return':
    case 'close':
    case 'inbound':
    case 'bot_state':
      return []
    default: {
      const unhandled: never = change

      return unhandled
    }
  }
}

/**
 * Who holds an open ticket. Nobody holds a closed one, even though it keeps its last assignee.
 */
export function holder(state: TicketState): AttendantRef | null {
  return state.status === 'in_progress' ? state.assignee : null
}

export interface TicketOpening {
  state: TicketState
  facts: TicketFact[]
}

export function planOpening(queueId: QueueId, origin: 'inbound' | 'outbound'): TicketOpening {
  return { state: { status: 'queued', queueId }, facts: [{ fact: 'opened', queueId, origin }] }
}

function assume(
  ticket: TicketSnapshot,
  state: OpenState,
  actor: Actor,
  context: PlanContext,
): Plan {
  if (actor.kind === 'system') return rejected('actor_cannot_hold')

  if (!actor.active) return rejected('attendant_inactive')

  if (!mayHold(actor, state.queueId, context)) return rejected('not_member')

  const current = holder(state)

  if (current !== null && current.kind === 'human' && current.id !== actor.id) {
    return rejected('held_by_other')
  }

  return transition(ticket, inProgress(state.queueId, actor), 'assume', context)
}

function handTo(
  ticket: TicketSnapshot,
  queueId: QueueId,
  to: AttendantId,
  via: 'assign' | 'transfer',
  context: PlanContext,
): Plan {
  const target = context.target ?? { kind: 'human', id: to, active: true }
  const assignee: AttendantRef = { kind: target.kind, id: to }

  if (!target.active) return rejected('attendant_inactive')

  if (!mayHold(assignee, queueId, context)) return rejected('not_member')

  return transition(ticket, inProgress(queueId, assignee), via, context)
}

function reply(
  ticket: TicketSnapshot,
  state: OpenState,
  actor: Actor,
  at: DateTime,
  context: PlanContext,
): Plan {
  if (actor.kind === 'system') return rejected('not_assignee')

  if (!actor.active) return rejected('attendant_inactive')

  const current = holder(state)

  if (current !== null) {
    return current.id === actor.id
      ? settle(ticket, replied(ticket, actor, at), [])
      : rejected('not_assignee')
  }

  if (actor.kind !== 'human') return rejected('not_assignee')

  if (!mayHold(actor, state.queueId, context)) return rejected('not_member')

  const assumed = moveTo(ticket, inProgress(state.queueId, actor), context.now)

  return settle(ticket, replied(assumed, actor, at), factsBetween(state, assumed.state, 'reply'))
}

function storeBotState(
  ticket: TicketSnapshot,
  state: OpenState,
  actor: Actor,
  botState: JsonValue,
): Plan {
  if (actor.kind !== 'bot') return rejected('not_assignee')

  if (!actor.active) return rejected('attendant_inactive')

  const current = holder(state)

  if (current === null || current.id !== actor.id) return rejected('not_assignee')

  if (ticket.botState[actor.id] === botState) return { outcome: 'unchanged' }

  return settle(ticket, { ...ticket, botState: { ...ticket.botState, [actor.id]: botState } }, [])
}

function transition(
  ticket: TicketSnapshot,
  state: TicketState,
  via: GestureName,
  context: PlanContext,
): Plan {
  return settle(ticket, moveTo(ticket, state, context.now), factsBetween(ticket.state, state, via))
}

/**
 * Every helper here reuses the current value unless it differs, so comparing by reference is
 * exact. A state change always emits a fact, so the state needs no comparison of its own.
 */
function settle(ticket: TicketSnapshot, next: TicketSnapshot, facts: TicketFact[]): Plan {
  const countersUnchanged =
    next.unreadCount === ticket.unreadCount &&
    next.lastActivityAt === ticket.lastActivityAt &&
    next.firstResponseAt === ticket.firstResponseAt &&
    next.botState === ticket.botState

  if (facts.length === 0 && countersUnchanged) return { outcome: 'unchanged' }

  return { outcome: 'changed', next: { ...next, version: ticket.version + 1 }, facts }
}

function moveTo(ticket: TicketSnapshot, state: TicketState, now: DateTime): TicketSnapshot {
  const assignee = holder(state)
  const stampsAssignedAt = assignee !== null && KIND_RULES[assignee.kind].stampsAssignedAt

  return {
    ...ticket,
    state,
    assignedAt: ticket.assignedAt ?? (stampsAssignedAt ? now : null),
    closedAt: state.status === 'closed' ? now : ticket.closedAt,
  }
}

function replied(ticket: TicketSnapshot, author: Attendant, at: DateTime): TicketSnapshot {
  const rules = KIND_RULES[author.kind]

  return {
    ...ticket,
    firstResponseAt: ticket.firstResponseAt ?? (rules.replyCountsAsFirstResponse ? at : null),
    unreadCount: rules.replyClearsUnread ? 0 : ticket.unreadCount,
    lastActivityAt: later(ticket.lastActivityAt, at),
  }
}

function factsBetween(
  from: TicketState,
  to: TicketState,
  via: GestureName | 'reply',
): TicketFact[] {
  const facts: TicketFact[] = []
  const before = assigneeOf(from)
  const after = assigneeOf(to)

  if (from.queueId !== to.queueId) {
    facts.push({ fact: 'queue_changed', from: from.queueId, to: to.queueId })
  }

  if (!sameAttendant(before, after)) {
    facts.push({ fact: 'assignment_changed', from: before, to: after, via })
  }

  if (to.status === 'closed' && from.status !== 'closed') {
    facts.push({ fact: 'closed', reason: to.reason })
  }

  return facts
}

function assigneeOf(state: TicketState) {
  return state.status === 'queued' ? null : state.assignee
}

function sameAttendant(a: AttendantRef | null, b: AttendantRef | null) {
  if (a === null || b === null) return a === b

  return a.id === b.id && a.kind === b.kind
}

function mayHold(attendant: AttendantRef, queueId: QueueId, context: PlanContext) {
  return !KIND_RULES[attendant.kind].needsMembership || context.isMember(attendant.id, queueId)
}

function inProgress(queueId: QueueId, attendant: AttendantRef): TicketState {
  return { status: 'in_progress', queueId, assignee: { kind: attendant.kind, id: attendant.id } }
}

function later(a: DateTime, b: DateTime) {
  return b.toMillis() > a.toMillis() ? b : a
}

function rejected(reason: Rejection): Plan {
  return { outcome: 'rejected', reason }
}
