import {
  holder,
  type AttendantId,
  type MessageId,
  type TicketId,
  type TicketSnapshot,
} from '@enzopita/adonisjs-inbox'
import { DateTime } from 'luxon'

import type { Variables } from './graph/values.ts'
import type { EndReason, RunState, Trigger, Waiting } from './interpreter.ts'
import type { FlowBindingId, FlowId, FlowRunId, FlowVersionId } from './types.ts'

/**
 * The interpreter's own endings, plus the ones a run gets from outside a turn:
 *
 * - `taken_over`: the ticket left the bot without the run deciding it;
 * - `ticket_closed`: the ticket closed under the run, such as by an inactivity automation;
 * - `stopped`: `inboxFlows.stop()`;
 * - `replaced`: a manual start replaced it;
 * - `start_expired`: a manual start that never reached the bot.
 */
export type RunEndReason =
  | EndReason
  | 'taken_over'
  | 'ticket_closed'
  | 'stopped'
  | 'replaced'
  | 'start_expired'

/**
 * Endings after which a human owns the ticket. A binding never starts a run on a ticket that
 * has one, so a flow that handed a ticket to a person never takes it back by itself.
 */
export const HUMAN_OWNED = ['handed_off', 'taken_over', 'stopped'] as const satisfies RunEndReason[]

/**
 * Where a running run rests between turns. A turn advances until a wait or an end, so a running
 * run is always waiting.
 */
export type RunWait = Omit<Extract<RunState, { status: 'waiting' }>, 'status' | 'vars'>

interface RunBase {
  id: FlowRunId
  ticketId: TicketId
  flowId: FlowId
  versionId: FlowVersionId
  /**
   * Bumped by every write to the row, and compared by every writer.
   */
  revision: number
  bindingId: FlowBindingId | null
  startedById: AttendantId | null
  vars: Variables
  createdAt: DateTime
}

/**
 * A row of `inbox_flow_runs`. Its CHECK constraints admit exactly these three cases.
 */
export type FlowRun =
  | (RunBase & { status: 'pending'; deadline: DateTime })
  | (RunBase & {
      status: 'running'
      wait: RunWait
      /**
       * The ticket's version once the bot turn that last wrote the run committed.
       */
      ticketVersion: number
    })
  | (RunBase & {
      status: 'ended'
      reason: RunEndReason
      detail: string | null
      endedAt: DateTime
    })

export type PendingRun = Extract<FlowRun, { status: 'pending' }>

export type RunningRun = Extract<FlowRun, { status: 'running' }>

export type LiveRun = PendingRun | RunningRun

type StoredWaiting =
  | (Omit<Extract<Waiting, { for: 'message' }>, 'timeoutAt'> & { timeoutAt: string | null })
  | (Omit<Extract<Waiting, { for: 'time' }>, 'until'> & { until: string })

interface StoredWait {
  waiting: StoredWaiting
  seen: MessageId | null
  waits: number
}

/**
 * The `waiting` column. Times are ISO strings with their offset.
 */
export function encodeWait(wait: RunWait) {
  const { waiting } = wait

  const stored: StoredWait = {
    ...wait,
    waiting:
      waiting.for === 'time'
        ? { ...waiting, until: waiting.until.toISO() ?? '' }
        : { ...waiting, timeoutAt: waiting.timeoutAt?.toISO() ?? null },
  }

  return JSON.stringify(stored)
}

export function decodeWait(text: string): RunWait {
  const stored: StoredWait = JSON.parse(text)
  const { waiting } = stored
  const time = (iso: string) => DateTime.fromISO(iso, { setZone: true })

  return {
    ...stored,
    waiting:
      waiting.for === 'time'
        ? { ...waiting, until: time(waiting.until) }
        : { ...waiting, timeoutAt: waiting.timeoutAt === null ? null : time(waiting.timeoutAt) },
  }
}

/**
 * What a turn's `wake` carries: the run, then the wait inside it. A run's wait tokens repeat
 * across runs of one graph, so the run id keeps a late wake from an earlier run on the ticket
 * from waking a later one.
 */
export function wakeToken(runId: FlowRunId, wait: string) {
  return `${runId}:${wait}`
}

/**
 * The token `start` wakes a pending run with, when the bot already holds the ticket.
 */
export function startToken(runId: FlowRunId) {
  return wakeToken(runId, 'start')
}

export type TurnTrigger =
  | { kind: 'assigned'; version: number }
  | { kind: 'message' }
  | { kind: 'wake'; token: string }

/**
 * - `select`: pick a flow from the bindings, after ending `supersede`, a run the bot lost track
 *   of;
 * - `enter`: start the pending run a manual start left;
 * - `resume`: hand the trigger to the running run's interpreter;
 * - `idle`: nothing to do, so the turn writes nothing.
 */
export type TurnPlan =
  | { kind: 'idle' }
  | { kind: 'select'; supersede: RunningRun | null }
  | { kind: 'enter'; run: PendingRun }
  | { kind: 'resume'; run: RunningRun; trigger: Trigger }

/**
 * The turn table, by trigger and live run:
 *
 * | trigger    | no live run | pending | running                                                 |
 * |------------|-------------|---------|---------------------------------------------------------|
 * | `assigned` | select      | enter   | idle when written after the handover, else supersede it |
 * | `message`  | select      | enter   | resume                                                  |
 * | `wake`     | idle        | enter   | resume when the token names it, else idle               |
 *
 * A turn only runs while the bot holds the ticket, so a pending run is entered whatever woke the
 * bot: it was made for this ticket. The inbox runs an `assigned` turn again on a fresh read when
 * its commit conflicts, so a running run it finds may be one another turn wrote since the
 * handover, at a later ticket version. One written before the handover means the ticket left the
 * bot and came back without the run hearing of it, and that run is over.
 */
export function decideTurn(trigger: TurnTrigger, live: LiveRun | null): TurnPlan {
  if (live === null)
    return trigger.kind === 'wake' ? { kind: 'idle' } : { kind: 'select', supersede: null }

  if (live.status === 'pending') return { kind: 'enter', run: live }

  switch (trigger.kind) {
    case 'assigned':
      return live.ticketVersion > trigger.version
        ? { kind: 'idle' }
        : { kind: 'select', supersede: live }
    case 'message':
      return { kind: 'resume', run: live, trigger }
    case 'wake': {
      const prefix = `${live.id}:`

      return trigger.token.startsWith(prefix)
        ? {
            kind: 'resume',
            run: live,
            trigger: { kind: 'wake', token: trigger.token.slice(prefix.length) },
          }
        : { kind: 'idle' }
    }
  }
}

/**
 * Why a live run is over given its ticket now, or `null` while it isn't. A pending run before its
 * deadline is a start whose assign hasn't landed yet.
 */
export function lostReason(
  run: LiveRun,
  ticket: TicketSnapshot,
  botId: AttendantId,
  now: DateTime,
): RunEndReason | null {
  if (ticket.state.status === 'closed') return 'ticket_closed'

  if (holder(ticket.state)?.id === botId) return null

  if (run.status === 'running') return 'taken_over'

  return run.deadline <= now ? 'start_expired' : null
}
