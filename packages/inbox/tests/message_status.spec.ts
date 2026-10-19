import { test } from '@japa/runner'

import { advanceableFrom, advances } from '../src/message/status.ts'
import type { MessageStatus } from '../src/types.ts'

const statuses: MessageStatus[] = ['pending', 'sent', 'delivered', 'read', 'played', 'failed']

const forward = new Set([
  'pending>sent',
  'pending>delivered',
  'pending>read',
  'pending>played',
  'pending>failed',
  'sent>delivered',
  'sent>read',
  'sent>played',
  'sent>failed',
  'delivered>read',
  'delivered>played',
  'read>played',
])

test.group('message status', () => {
  test('{from} only moves forward')
    .with(statuses.map(from => ({ from })))
    .run(({ assert }, { from }) => {
      for (const to of statuses) {
        assert.equal(advances(from, to), forward.has(`${from}>${to}`), `${from} -> ${to}`)
      }
    })

  test('advanceableFrom({to}) lists the statuses that advance to it')
    .with<Array<{ to: MessageStatus; from: MessageStatus[] }>>([
      { to: 'pending', from: [] },
      { to: 'sent', from: ['pending'] },
      { to: 'delivered', from: ['pending', 'sent'] },
      { to: 'read', from: ['pending', 'sent', 'delivered'] },
      { to: 'played', from: ['pending', 'sent', 'delivered', 'read'] },
      { to: 'failed', from: ['pending', 'sent'] },
    ])
    .run(({ assert }, { to, from }) => {
      assert.sameMembers(advanceableFrom(to), from)
    })
})
