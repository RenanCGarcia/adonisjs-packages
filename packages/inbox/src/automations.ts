import type { ModelQueryBuilderContract } from '@adonisjs/lucid/types/model'
import type { DateTime, DurationLike } from 'luxon'

import { sqlTime } from './internal/unit_of_work.ts'
import type { InboxModelOf } from './mixins/main.ts'

import type {
  AttendantRef,
  BotKey,
  ChannelId,
  CloseReason,
  Gesture,
  MessageContent,
  QueueId,
  TicketSnapshot,
  TicketStatus,
} from './types.ts'

/**
 * What an automation does to a ticket. The inbox applies it through the ticket state machine,
 * as the system actor named after the automation.
 */
export type Effect<Bots extends string = BotKey> =
  | { effect: 'apply'; gesture: Gesture }
  | { effect: 'assign_bot'; bot: Bots }
  /**
   * Stored pending with no author and dispatched after the commit, like any outgoing message.
   */
  | { effect: 'send'; content: MessageContent }

export interface TicketMoment {
  ticket: TicketSnapshot
  channel: { id: ChannelId; provider: string }
  now: DateTime
}

/**
 * Which tickets a tick automation looks at, as plain column comparisons every database runs.
 * `status` defaults to `open`, queued or in progress.
 */
export interface CandidateFilter {
  status?: TicketStatus | TicketStatus[] | 'open'
  lastActivityBefore?: DateTime
  queueId?: QueueId
  assigneeKind?: AttendantRef['kind'] | 'none'
}

interface AutomationBase<Bots extends string> {
  /**
   * Recorded as the `source` of the system actor on the ticket events it causes.
   */
  name: string
  decide(moment: TicketMoment): Effect<Bots>[]
}

/**
 * Runs on the ticket a trigger leaves, and its effects land in the trigger's own write: a ticket
 * an automation assigns on `ticket_opened` is never seen queued. `message_received` runs on
 * inbound messages only.
 */
export interface EventAutomation<Bots extends string = BotKey> extends AutomationBase<Bots> {
  on: 'ticket_opened' | 'message_received'
}

/**
 * Runs from `inbox.tick()`. `decide` runs again on each fresh read of every candidate, and its
 * effects land in one compare-and-swap, so a second tick finds nothing left to do. A tick
 * automation that only sends sends on every tick, so pair a send with a change.
 */
export interface TickAutomation<Bots extends string = BotKey> extends AutomationBase<Bots> {
  on: 'tick'
  candidates(clock: { now: DateTime }): CandidateFilter
}

/**
 * Effects never trigger automations, so automations can't loop through each other.
 */
export type Automation<Bots extends string = BotKey> = EventAutomation<Bots> | TickAutomation<Bots>

/**
 * `NoInfer` keeps the config's bot keys from typing an automation that assigns no bot for every
 * string, which no config would accept.
 */
export function defineAutomation<const Bots extends string = never>(
  automation: Automation<Bots>,
): Automation<NoInfer<Bots>> {
  return automation
}

type TicketModel = InboxModelOf<'ticket'>

/**
 * The filter as conditions on a ticket query.
 */
export function whereCandidates(Ticket: TicketModel, filter: CandidateFilter) {
  const { status = 'open', lastActivityBefore, queueId, assigneeKind } = filter
  const statuses = status === 'open' ? ['queued', 'in_progress'] : [status].flat()

  return (query: ModelQueryBuilderContract<TicketModel>) => {
    query.whereIn('status', statuses)

    if (lastActivityBefore !== undefined) {
      query.where('lastActivityAt', '<', sqlTime(Ticket, lastActivityBefore))
    }

    if (queueId !== undefined) query.where('queueId', queueId)

    if (assigneeKind === 'none') query.whereNull('assigneeId')
    else if (assigneeKind !== undefined) query.where('assigneeKind', assigneeKind)
  }
}

type When = (moment: TicketMoment) => boolean

const always: When = () => true

export const automations = {
  /**
   * Opens tickets already assigned to `bot` while `when` holds, such as after hours.
   */
  assignOnOpen<const Bots extends string>(options: { bot: Bots; when?: When }): Automation<Bots> {
    const when = options.when ?? always

    return {
      name: 'assign_on_open',
      on: 'ticket_opened',
      decide: moment => (when(moment) ? [{ effect: 'assign_bot', bot: options.bot }] : []),
    }
  },

  /**
   * Hands a queued ticket to `bot` when a message arrives while `when` holds, such as a bot that
   * takes over after hours what nobody picked up.
   */
  assignQueuedOnMessage<const Bots extends string>(options: {
    bot: Bots
    when: When
  }): Automation<Bots> {
    return {
      name: 'assign_queued_on_message',
      on: 'message_received',
      decide: moment =>
        moment.ticket.state.status === 'queued' && options.when(moment)
          ? [{ effect: 'assign_bot', bot: options.bot }]
          : [],
    }
  },

  /**
   * Closes open tickets with no activity for `after`.
   */
  closeInactive(options: { after: DurationLike; reason?: CloseReason }): Automation<never> {
    const reason = options.reason ?? 'inactivity'

    return {
      name: 'close_inactive',
      on: 'tick',
      candidates: ({ now }) => ({ status: 'open', lastActivityBefore: now.minus(options.after) }),
      decide: ({ ticket, now }) =>
        ticket.lastActivityAt < now.minus(options.after)
          ? [{ effect: 'apply', gesture: { gesture: 'close', reason } }]
          : [],
    }
  },

  /**
   * Sends a message on every ticket that opens while `when` holds, such as a greeting.
   */
  autoReply(
    options: ({ content: MessageContent } | { text: string }) & { when?: When },
  ): Automation<never> {
    const content: MessageContent =
      'content' in options ? options.content : { kind: 'text', text: options.text }

    const when = options.when ?? always

    return {
      name: 'auto_reply',
      on: 'ticket_opened',
      decide: moment => (when(moment) ? [{ effect: 'send', content }] : []),
    }
  },
}
