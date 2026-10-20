import { randomUUID } from 'node:crypto'

import { DateTime } from 'luxon'

import type { ChannelId } from '../types.ts'
import type {
  AdapterChannel,
  Capability,
  ChannelAdapter,
  ConnectionState,
  NormalizedEvent,
  OutgoingMessage,
  SendOptions,
  SendResult,
  WebhookRequest,
} from './port.ts'

const DATE_FIELDS = new Set(['sentAt'])

const TYPES = new Set<string>(['message_received', 'message_echoed', 'message_status_changed'])

export interface FakeSend {
  channel: AdapterChannel
  message: OutgoingMessage
}

export type FakeResponder = (message: OutgoingMessage, options: SendOptions) => Promise<SendResult>

const accept: FakeResponder = async () => ({ status: 'accepted', externalId: randomUUID() })

/**
 * A real adapter with no provider behind it. A webhook carries the `x-fake-secret` header equal to
 * the channel's `credentials.secret`, and its body is `fakeWebhookBody(...)`. Every send is
 * recorded in `sends` and answered by `respond`, which accepts by default. A channel is
 * connected until `disconnect`.
 */
export class FakeChannelAdapter implements ChannelAdapter {
  readonly capabilities: readonly Capability[]
  readonly sends: FakeSend[] = []
  respond: FakeResponder = accept
  readonly #disconnected = new Set<ChannelId>()

  constructor(capabilities: readonly Capability[] = ['outbound_echo', 'send_text']) {
    this.capabilities = capabilities
  }

  verify(channel: AdapterChannel, request: WebhookRequest) {
    const header = request.headers['x-fake-secret']
    const { credentials } = channel

    if (!(credentials instanceof Object) || Array.isArray(credentials)) return false

    return (
      header !== undefined &&
      !Array.isArray(header) &&
      header !== '' &&
      header === credentials.secret
    )
  }

  parse(rawBody: string): NormalizedEvent[] {
    let events: unknown

    try {
      events = JSON.parse(rawBody)
    } catch {
      return []
    }

    if (!Array.isArray(events)) return []

    return events.map(event => {
      if (!(event instanceof Object) || !TYPES.has(event.type)) return { type: 'unsupported' }

      // SAFETY: fakeWebhookBody wrote this event from a NormalizedEvent of a known type.
      return Object.fromEntries(
        Object.entries(event).map(([key, value]) => [
          key,
          DATE_FIELDS.has(key) ? DateTime.fromISO(String(value)) : value,
        ]),
      ) as NormalizedEvent
    })
  }

  async send(channel: AdapterChannel, message: OutgoingMessage, options: SendOptions) {
    options.signal.throwIfAborted()
    this.sends.push({ channel, message })

    return this.respond(message, options)
  }

  async connect(channel: AdapterChannel) {
    this.#disconnected.delete(channel.id)

    return this.checkHealth(channel)
  }

  async disconnect(channel: AdapterChannel) {
    this.#disconnected.add(channel.id)
  }

  async checkHealth(channel: AdapterChannel): Promise<ConnectionState> {
    return this.#disconnected.has(channel.id)
      ? { status: 'disconnected', reason: 'logged_out' }
      : { status: 'connected' }
  }

  reset() {
    this.sends.length = 0
    this.respond = accept
    this.#disconnected.clear()
  }
}

export function fakeWebhookBody(...events: NormalizedEvent[]) {
  return JSON.stringify(events)
}
