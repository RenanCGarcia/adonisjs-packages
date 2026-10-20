import type { DateTime, DurationLike } from 'luxon'

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

export interface BotTurn<State extends JsonValue> {
  /**
   * `assigned` when the bot just got the ticket, `message` when the contact wrote.
   */
  trigger: 'assigned' | 'message'
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
}

/**
 * A bot can only hand the ticket on. It never assumes or assigns.
 */
export type BotHandoff = Extract<Gesture, { gesture: 'return' | 'transfer' | 'close' }>

export type BotReply<State extends JsonValue> =
  | { kind: 'reply'; messages: MessageContent[]; state: State; handoff?: BotHandoff }
  /**
   * Asks for the turn again after `retryIn`, such as while a file is still being processed. A
   * wait uses up one of the turn's attempts.
   */
  | { kind: 'wait'; retryIn: DurationLike }
  | { kind: 'silent'; state: State }

/**
 * A bot attendant, registered in `config.bots` under its key and made once through the
 * container, so `@inject()` works. The inbox runs its turns:
 *
 * - after each inbound message on a ticket the bot holds, once `debounce` passed without a newer
 *   one, and when it gets the ticket from a human or an automation;
 * - outside any transaction, then commits the replies, the state and the handoff together, guarded by
 *   the ticket version the turn read;
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
