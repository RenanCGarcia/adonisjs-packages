import { test } from '@japa/runner'
import { DateTime } from 'luxon'

import { FakeChannelAdapter, channelAdapterContract, fakeWebhookBody } from '../src/testing/main.ts'
import type { ChannelId } from '../src/types.ts'

channelAdapterContract('fake', () => new FakeChannelAdapter())

// SAFETY: a fixture id the adapter only passes through.
const channel = { id: 1 as ChannelId, credentials: { secret: 's3cret' } }

test.group('fake channel adapter', () => {
  test('verify accepts the channel secret and nothing else', ({ assert }) => {
    const fake = new FakeChannelAdapter()
    const request = (secret: string) => ({ headers: { 'x-fake-secret': secret }, rawBody: '[]' })

    assert.isTrue(fake.verify(channel, request('s3cret')))
    assert.isFalse(fake.verify(channel, request('other')))
    assert.isFalse(fake.verify({ ...channel, credentials: {} }, request('')))
  })

  test('parse reads back the events of a webhook body', ({ assert }) => {
    const sentAt = DateTime.fromISO('2026-01-05T10:00:00.000Z')

    const [event] = new FakeChannelAdapter().parse(
      fakeWebhookBody({
        type: 'message_received',
        externalId: 'wamid.1',
        from: { address: '+5511999990000' },
        text: 'hello',
        sentAt,
      }),
    )

    assert.equal(event?.type, 'message_received')
    assert.equal(event?.type === 'message_received' && event.sentAt.toMillis(), sentAt.toMillis())
  })

  test('send records the message and answers with the scripted result', async ({ assert }) => {
    const fake = new FakeChannelAdapter()
    const message = { to: { address: '+5511999990000' }, text: 'hi', clientRef: 'ref-1' }

    fake.respond = async () => ({ status: 'rejected', code: 'recipient_invalid' })

    const result = await fake.send(channel, message, { signal: new AbortController().signal })

    assert.deepEqual(result, { status: 'rejected', code: 'recipient_invalid' })
    assert.deepEqual(fake.sends, [{ channel, message }])
  })
})
