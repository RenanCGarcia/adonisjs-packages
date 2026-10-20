import type { ModelQueryBuilderContract } from '@adonisjs/lucid/types/model'
import { DateTime } from 'luxon'

import type { SendResult } from '../adapters/port.ts'
import type { ResolvedInboxConfig } from '../define_config.ts'
import { InboxError } from '../errors.ts'
import type { InboxModelOf } from '../mixins/main.ts'
import { DISPATCH_LEASE_MS, SEND_TIMEOUT_MS } from '../tasks.ts'
import type { MessageId, MessageStatus } from '../types.ts'
import { affectedRows, sqlTime } from './unit_of_work.ts'

type MessageModel = InboxModelOf<'message'>

type MessageQuery = ModelQueryBuilderContract<MessageModel>

export type Announce = (messageId: MessageId, status: MessageStatus) => Promise<void>

/**
 * Pending messages no dispatch owns: never claimed, or claimed longer than a lease ago, by a
 * worker that died mid-send.
 */
export function whereClaimable(Message: MessageModel, now: DateTime) {
  const expired = sqlTime(Message, now.minus({ milliseconds: DISPATCH_LEASE_MS }))

  return (query: MessageQuery) =>
    query
      .where('status', 'pending')
      .where(lease => lease.whereNull('dispatchedAt').orWhere('dispatchedAt', '<', expired))
}

/**
 * Pending messages a dispatch owns right now, whose outcome isn't known yet.
 */
export function whereInFlight(Message: MessageModel, now: DateTime) {
  const expired = sqlTime(Message, now.minus({ milliseconds: DISPATCH_LEASE_MS }))

  return (query: MessageQuery) =>
    query.where('status', 'pending').where('dispatchedAt', '>=', expired)
}

/**
 * Takes a pending message to its provider. The claim is a conditional update, so of two
 * dispatches of one message only one talks to the provider. The call runs outside any
 * transaction, so no lock waits on the network.
 */
export async function dispatchMessage(
  config: ResolvedInboxConfig,
  announce: Announce,
  messageId: MessageId,
) {
  const Message = await config.model('message')
  const now = DateTime.now()

  const claimed = await Message.query()
    .where('id', messageId)
    .where(whereClaimable(Message, now))
    .update({ dispatchedAt: sqlTime(Message, now) })

  if (affectedRows(claimed) === 0) return

  const message = await Message.findOrFail(messageId)

  if (message.clientRef === null) {
    throw new InboxError(
      'E_INBOX_INVALID_ROW',
      `inbox: pending message ${messageId} has no client_ref, which every outgoing message gets`,
    )
  }

  const Conversation = await config.model('conversation')
  const Contact = await config.model('contact')
  const Channel = await config.model('channel')
  const conversation = await Conversation.findOrFail(message.conversationId)
  const contact = await Contact.findOrFail(conversation.contactId)
  const channel = await Channel.findOrFail(conversation.channelId)
  const signal = AbortSignal.timeout(SEND_TIMEOUT_MS)
  const release = () => pending(Message, messageId).update({ dispatchedAt: null })
  let result: SendResult

  try {
    result = await config.adapters.get(channel.provider).send(
      { id: channel.id, credentials: channel.credentials },
      {
        to: { address: contact.address },
        content: message.content,
        clientRef: message.clientRef,
      },
      { signal },
    )
  } catch (error) {
    if (!signal.aborted) {
      await release()
      throw error
    }

    result = { status: 'rejected', code: 'outcome_unknown' }
  }

  if (result.status === 'rejected' && result.code === 'rate_limited') {
    await release()
    throw new Error(`inbox: the provider rate limited message ${messageId}`)
  }

  const settled =
    result.status === 'accepted'
      ? { status: 'sent' as const, externalId: result.externalId }
      : { status: 'failed' as const, failureCode: result.code }

  const updated = await pending(Message, messageId).update(settled)

  if (affectedRows(updated) > 0) await announce(messageId, settled.status)
}

function pending(Message: MessageModel, messageId: MessageId) {
  return Message.query().where('id', messageId).where('status', 'pending')
}
