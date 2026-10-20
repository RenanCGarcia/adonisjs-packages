import type { TransactionClientContract } from '@adonisjs/lucid/types/database'
import type { DateTime, DurationLike } from 'luxon'

import type { Later } from './internal/unit_of_work.ts'
import type {
  ChannelId,
  ContactId,
  Gesture,
  JsonValue,
  MessageContent,
  MessageId,
  TicketSnapshot,
} from './types.ts'

/**
 * An inbound message a bot turn answers.
 */
export interface InboundMessage {
  id: MessageId
  content: MessageContent
  sentAt: DateTime
}

export type BotTurn<State extends JsonValue> = {
  ticket: TicketSnapshot
  /**
   * The channel the ticket's conversation is on, and so the one its replies go out through.
   */
  channel: { id: ChannelId; provider: string }
  contactId: ContactId
  /**
   * The inbound messages since the last reply by an attendant, human or bot, oldest first. An
   * automation's message or an echo from the phone answers nothing.
   */
  unanswered: InboundMessage[]
  state: State
  now: DateTime
} & (
  | {
      /**
       * `assigned` when the bot just got the ticket, `message` when the contact wrote.
       */
      trigger: 'assigned' | 'message'
    }
  | {
      /**
       * Asked for through `inbox.tickets.wake()`, with the token given there.
       */
      trigger: 'wake'
      token: string
    }
)

/**
 * A bot can only hand the ticket on. It never assumes or assigns.
 */
export type BotHandoff = Extract<Gesture, { gesture: 'return' | 'transfer' | 'close' }>

/**
 * The bot's own writes, made in the turn's transaction after its replies are stored, so they
 * land with the turn or roll back with it. `later` runs work after the commit.
 *
 * Return `stale` when a row of the bot's moved since the turn read it. The turn then rolls back
 * and runs again on a fresh read, like a turn whose batch grew, and is dropped once it runs out
 * of reruns. A throw rolls back and retries the turn like any error before the commit.
 */
export type BotWithin = (
  trx: TransactionClientContract,
  ticket: TicketSnapshot,
  later: Later,
) => Promise<'ok' | 'stale'>

export type BotReply<State extends JsonValue> =
  | {
      kind: 'reply'
      messages: MessageContent[]
      state: State
      handoff?: BotHandoff
      within?: BotWithin
    }
  /**
   * Asks for the turn again after `retryIn`, such as while a file is still being processed. A
   * wait uses up one of the turn's attempts.
   */
  | { kind: 'wait'; retryIn: DurationLike }
  | { kind: 'silent'; state: State; within?: BotWithin }

/**
 * A bot attendant, registered in `config.bots` under its key and made once through the
 * container, so `@inject()` works. The inbox runs its turns:
 *
 * - after each inbound message on a ticket the bot holds, once `debounce` passed without a newer
 *   one, when it gets the ticket from a human or an automation, and when woken through
 *   `inbox.tickets.wake()`;
 * - outside any transaction, then commits the replies, the state, the handoff and `within`
 *   together, guarded by the ticket version the turn read;
 * - drops the turn when the bot lost the ticket meanwhile, and runs it again with the longer
 *   batch when a message arrived, three times at most before committing against the latest
 *   version;
 * - never again once committed, so a reply is sent at most once.
 */
export interface Bot<State extends JsonValue> {
  debounce?: DurationLike
  initialState(): State
  turn(turn: BotTurn<State>): Promise<BotReply<State>>
}

/**
 * Typed by the instance alone. The container supplies the constructor's arguments.
 */
export type BotClass = new (...args: never[]) => Bot<JsonValue>

export type BotLoader = () => Promise<{ default: BotClass }>
