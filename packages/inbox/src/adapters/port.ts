import type { ConfigProvider } from '@adonisjs/core/types'
import type { DateTime } from 'luxon'

import type { ChannelId, JsonValue, MessageContent, MessageKind, MessageStatus } from '../types.ts'

/**
 * The capability an adapter declares for each kind of content it can send.
 */
export const SENDS = { text: 'send_text' } as const satisfies Record<MessageKind, string>

/**
 * What an adapter may declare beyond the port every adapter implements. The ingest drops an
 * event whose capability the adapter doesn't declare, and a send of a kind it doesn't declare is
 * rejected.
 */
export const CAPABILITIES = ['outbound_echo', ...Object.values(SENDS)] as const

export type Capability = (typeof CAPABILITIES)[number]

/**
 * What an adapter sees of a channel row. The credentials are opaque to the inbox, so the adapter
 * validates them.
 */
export interface AdapterChannel {
  id: ChannelId
  credentials: JsonValue
}

export interface WebhookRequest {
  headers: Record<string, string | string[] | undefined>
  rawBody: string
}

export interface ContactIdentity {
  address: string
}

export type DeliveryStatus = Exclude<MessageStatus, 'pending'>

export type RejectionCode =
  | 'window_closed'
  | 'recipient_invalid'
  | 'rate_limited'
  | 'auth_failed'
  | 'channel_disconnected'
  /**
   * The provider may have taken the message. The inbox never sends it again, and a later status
   * carrying its `clientRef` settles it.
   */
  | 'outcome_unknown'
  | 'unknown'

/**
 * What a provider's webhook means, in the inbox's terms. `unsupported` stands for anything the
 * inbox doesn't handle yet, so `parse` never has to throw.
 */
export type NormalizedEvent =
  | {
      type: 'message_received'
      externalId: string
      from: ContactIdentity
      profileName?: string
      content: MessageContent
      sentAt: DateTime
    }
  | {
      type: 'message_echoed'
      externalId: string
      to: ContactIdentity
      content: MessageContent
      sentAt: DateTime
    }
  | {
      type: 'message_status_changed'
      externalId: string
      clientRef?: string
      status: DeliveryStatus
      error?: RejectionCode
    }
  | { type: 'unsupported' }

export interface OutgoingMessage {
  to: ContactIdentity
  /**
   * Only of a kind whose capability the adapter declares.
   */
  content: MessageContent
  /**
   * The outbox's idempotency key. An adapter whose provider takes one should pass it along and
   * return it in status events.
   */
  clientRef: string
}

export type SendResult =
  | { status: 'accepted'; externalId: string }
  | { status: 'rejected'; code: RejectionCode }

export interface SendOptions {
  signal: AbortSignal
}

export type DisconnectReason = 'logged_out' | 'pairing_expired' | 'auth_failed' | 'unknown'

/**
 * How a session-based provider pairs a number, by scanning a QR code or typing a code.
 */
export type ConnectMethod = { method: 'qr' } | { method: 'code'; phoneNumber: string }

/**
 * The QR code can be null while the provider's session is still starting.
 */
export type Pairing = { method: 'qr'; qr: string | null } | { method: 'code'; code: string }

export type ConnectionState =
  | { status: 'connected' }
  | { status: 'pairing'; pairing: Pairing }
  | { status: 'disconnected'; reason: DisconnectReason }

/**
 * Stored in the channel's `status` column.
 */
export type ChannelStatus = ConnectionState['status']

/**
 * Credentials the provider issued while connecting, for the inbox to store on the channel.
 */
export type ConnectResult = ConnectionState & { credentials?: JsonValue }

/**
 * A provider. `parse` never throws. `send` throws only when the message certainly did not leave,
 * which the outbox retries, and stops when `signal` aborts.
 */
export interface ChannelAdapter {
  readonly capabilities: readonly Capability[]
  verify(channel: AdapterChannel, request: WebhookRequest): boolean
  /**
   * Takes the body alone, because the headers aren't stored with the channel event.
   */
  parse(rawBody: string): NormalizedEvent[]
  send(channel: AdapterChannel, message: OutgoingMessage, options: SendOptions): Promise<SendResult>
  /**
   * The connection lifecycle of a provider with a session to pair. The inbox doesn't call these
   * yet. A provider reached through webhooks alone leaves them out.
   */
  connect?(channel: AdapterChannel, method?: ConnectMethod): Promise<ConnectResult>
  disconnect?(channel: AdapterChannel): Promise<void>
  checkHealth?(channel: AdapterChannel): Promise<ConnectionState>
}

/**
 * The `channels` config is keyed by the `provider` column value.
 */
export type AdapterProvider = ConfigProvider<ChannelAdapter>
