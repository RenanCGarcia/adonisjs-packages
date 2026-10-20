import { randomUUID } from 'node:crypto'

import { test } from '@japa/runner'
import { channelIn, eventually } from '@enzopita/adonisjs-inbox/testing'
import { DateTime } from 'luxon'

import { EFFECT_POLICY, type FlowGraph } from '../index.ts'
import { graph } from './helpers.ts'
import { bootFlows, effects, fake, MAX_STEPS, type FlowsApp } from './fixture.ts'

/**
 * Runs the effect node `effect`, then asks a question so the run waits.
 */
function emits(effect: 'note' | 'notify', text: string): FlowGraph {
  return graph({
    variables: [{ name: 'answer', type: 'text' }],
    nodes: [
      ['start', 'start'],
      ['effect', effect, { text }],
      [
        'ask',
        'question',
        { text: 'Anything else?', variable: 'answer', capture: 'text', retries: 0 },
      ],
      ['done', 'end'],
    ],
    edges: [
      ['start', 'default', 'effect'],
      ['effect', 'default', 'ask'],
      ['ask', 'answered', 'done'],
    ],
  })
}

test.group('flow effects', group => {
  let flowsApp: FlowsApp

  group.setup(async () => {
    flowsApp = await bootFlows()

    return () => flowsApp.terminate()
  })

  group.each.setup(() => {
    fake.reset()
    effects.reset()
  })

  const sent = () => fake.sends.map(({ message }) => message.content.text)

  async function start(flow: FlowGraph) {
    const { flowId } = await flowsApp.published(flow)
    const channel = await channelIn(flowsApp.app, 'flows')

    await flowsApp.bind(flowId, channel.channelId)
    await channel.write('hi')

    return { channel, ticketId: await channel.openTicket() }
  }

  test('an in-transaction effect lands once, with the reply of its turn', async ({ assert }) => {
    const { ticketId, channel } = await start(emits('note', 'met the contact'))

    assert.deepEqual(await flowsApp.notes(ticketId), ['met the contact'])
    assert.deepEqual(sent(), ['Anything else?'])

    await channel.write('no')

    assert.deepEqual(await flowsApp.notes(ticketId), ['met the contact'])
  })

  test('an in-transaction effect that fails rolls its turn back, and the retry lands it once', async ({
    assert,
  }) => {
    effects.failNotes = 1

    const { ticketId } = await start(emits('note', 'retried'))

    assert.deepEqual(sent(), [], 'the failed turn sent nothing')
    assert.deepEqual(await flowsApp.notes(ticketId), [], 'the failed turn wrote nothing')
    assert.deepEqual(await flowsApp.flows.runs.forTicket(ticketId), [])

    await eventually(() => sent().length > 0)

    assert.deepEqual(sent(), ['Anything else?'])
    assert.deepEqual(await flowsApp.notes(ticketId), ['retried'])
    assert.containsSubset(await flowsApp.flows.runs.forTicket(ticketId), [{ status: 'running' }])
  })

  test('an after-commit effect is delivered once after its turn commits', async ({ assert }) => {
    const text = `ping ${randomUUID()}`
    const { ticketId } = await start(emits('notify', text))
    const mine = () => effects.deliveries.filter(delivery => delivery.text === text)

    assert.containsSubset(mine(), [{ attempt: 1 }])

    await flowsApp.flows.tick(DateTime.now().plus({ hours: 1 }))

    assert.lengthOf(mine(), 1)
    assert.containsSubset(
      await flowsApp.db.from('inbox_flow_effects').where('ticket_id', ticketId),
      [{ status: 'done', attempts: 1 }],
    )
  })

  test('an after-commit effect that keeps failing is retried a bounded number of times', async ({
    assert,
  }) => {
    effects.failDeliveries = Number.POSITIVE_INFINITY

    const text = `ping ${randomUUID()}`
    const { ticketId } = await start(emits('notify', text))
    const mine = () => effects.deliveries.filter(delivery => delivery.text === text)

    for (let hour = 1; hour <= EFFECT_POLICY.attempts + 3; hour++) {
      await flowsApp.flows.tick(DateTime.now().plus({ hours: hour }))
    }

    const [key] = new Set(mine().map(({ idempotencyKey }) => idempotencyKey))

    assert.deepEqual(
      mine().map(({ attempt }) => attempt),
      Array.from({ length: EFFECT_POLICY.attempts }, (_, index) => index + 1),
    )
    assert.isTrue(mine().every(({ idempotencyKey }) => idempotencyKey === key))
    assert.containsSubset(
      await flowsApp.db.from('inbox_flow_effects').where('ticket_id', ticketId),
      [{ status: 'failed', attempts: EFFECT_POLICY.attempts, idempotency_key: key }],
    )
    assert.deepEqual(sent(), ['Anything else?'], 'the reply went out regardless')
  })

  test('a looping graph ends at the step budget, keeping what it said and dropping its effects', async ({
    assert,
  }) => {
    const { ticketId } = await start(
      graph({
        variables: [{ name: 'looped', type: 'boolean' }],
        nodes: [
          ['start', 'start'],
          ['mark', 'set_variable', { variable: 'looped', value: 'true' }],
          ['say', 'message', { text: 'again' }],
          ['write', 'note', { text: 'looped' }],
          ['more', 'condition', { variable: 'looped', operator: 'is_true' }],
          ['done', 'end'],
        ],
        edges: [
          ['start', 'default', 'mark'],
          ['mark', 'default', 'say'],
          ['say', 'default', 'write'],
          ['write', 'default', 'more'],
          ['more', 'true', 'say'],
          ['more', 'false', 'done'],
        ],
      }),
    )

    const said = sent()

    assert.isAbove(said.length, 1)
    assert.isAtMost(said.length, MAX_STEPS)
    assert.isTrue(said.every(text => text === 'again'))
    assert.deepEqual(await flowsApp.notes(ticketId), [])
    assert.containsSubset(await flowsApp.flows.runs.forTicket(ticketId), [
      { status: 'ended', reason: 'step_budget_exhausted' },
    ])
    assert.deepInclude(await flowsApp.db.from('inbox_tickets').where('id', ticketId).first(), {
      status: 'queued',
    })
  })
})
