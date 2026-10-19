import assert from 'node:assert/strict'

import { test } from '@japa/runner'

import type { AdapterChannel, ChannelAdapter } from '../adapters/port.ts'
import { AdapterRegistry } from '../adapters/registry.ts'
import type { ChannelId } from '../types.ts'

const GARBAGE = ['', 'garbage', 'null', '42', '{}', '[]', '[null]', '[{}]', '{"event":"unknown"}']

const unsigned = { headers: {}, rawBody: '[]' }

/**
 * What the inbox relies on from every adapter. Run it in the adapter's own test suite, with a
 * channel whose credentials the adapter accepts.
 */
export function channelAdapterContract(
  name: string,
  make: () => ChannelAdapter,
  // SAFETY: a fixture id the adapter only passes through.
  channel: AdapterChannel = { id: 1 as ChannelId, credentials: {} },
) {
  test.group(`channel adapter contract: ${name}`, () => {
    test('the registry accepts its capabilities', () => {
      const adapter = make()

      assert.equal(new AdapterRegistry(new Map([[name, adapter]])).get(name), adapter)
    })

    test('parse turns a body it cannot read into no events')
      .with(GARBAGE)
      .run((_, rawBody) => {
        const events = make().parse(rawBody)

        assert.ok(Array.isArray(events))
        assert.ok(events.every(event => event.type === 'unsupported'))
      })

    test('verify refuses an unsigned request', () => {
      assert.equal(make().verify(channel, unsigned), false)
    })

    test('send rejects once its signal aborted', async () => {
      const signal = AbortSignal.abort()
      const message = { to: { address: '+5511999990000' }, text: 'hi', clientRef: 'contract' }

      await assert.rejects(() => make().send(channel, message, { signal }))
    })
  })
}
