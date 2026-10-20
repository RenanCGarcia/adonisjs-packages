import type Channel from '#models/inbox/channel'
import type { NormalizedEvent } from '@enzopita/adonisjs-inbox'
import inbox from '@enzopita/adonisjs-inbox/services/main'
import vine from '@vinejs/vine'
import { DateTime } from 'luxon'
import { randomUUID } from 'node:crypto'

/**
 * What the fake adapter signs a webhook with.
 */
const fakeCredentials = vine.create({ secret: vine.string() })

export interface FakeInbound {
  from: string
  name?: string
  text: string
  /**
   * The provider's message id. A second webhook with the same one is ingested once.
   */
  externalId?: string
}

/**
 * A contact writing in on a fake channel: the webhook its provider would send, signed with the
 * channel's secret, through the same `inbox.ingest` as the webhook route. `not_fake` when the
 * channel has no fake secret.
 */
export async function writeIn(channel: Channel, { from, name, text, externalId }: FakeInbound) {
  const [invalid, credentials] = await fakeCredentials.tryValidate(channel.credentials)

  if (invalid) return 'not_fake'

  const event: NormalizedEvent = {
    type: 'message_received',
    externalId: externalId ?? randomUUID(),
    from: { address: from },
    profileName: name,
    content: { kind: 'text', text },
    sentAt: DateTime.now(),
  }

  return inbox.ingest(channel.webhookToken, {
    headers: { 'x-fake-secret': credentials.secret },
    rawBody: JSON.stringify([event]),
  })
}
