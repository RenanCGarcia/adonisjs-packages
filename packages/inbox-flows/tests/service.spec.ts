import { test } from '@japa/runner'
import type { TicketId } from '@enzopita/adonisjs-inbox'
import { channelIn } from '@enzopita/adonisjs-inbox/testing'

import type { FlowGraph } from '../index.ts'
import { graph } from './helpers.ts'
import { bootFlows, fake, refusedFlows, SYSTEM, type FlowsApp } from './playground.ts'

function says(text: string): FlowGraph {
  return graph({
    variables: [{ name: 'answer', type: 'text' }],
    nodes: [
      ['start', 'start'],
      ['ask', 'question', { text, variable: 'answer', capture: 'text', retries: 0 }],
      ['done', 'end'],
    ],
    edges: [
      ['start', 'default', 'ask'],
      ['ask', 'answered', 'done'],
    ],
  })
}

test.group('authoring flows', group => {
  let flowsApp: FlowsApp

  group.setup(async () => {
    flowsApp = await bootFlows()

    return () => flowsApp.terminate()
  })

  test('a draft saved over a revision someone else already saved is refused', async ({
    assert,
  }) => {
    const { flows } = flowsApp
    const flow = await flows.flows.create('drafts')

    const first = await flows.drafts.save(flow.id, says('One?'), flow.draftRevision)

    assert.containsSubset(first, { outcome: 'saved', revision: flow.draftRevision + 1 })

    const late = await flows.drafts.save(flow.id, says('Two?'), flow.draftRevision)

    assert.equal(late.outcome, 'stale')
    assert.deepEqual((await flows.flows.get(flow.id)).draft, says('One?'))
  })

  test('a draft that is only incomplete saves with its publish problems', async ({ assert }) => {
    const { flows } = flowsApp
    const flow = await flows.flows.create('incomplete')
    const dangling = graph({ nodes: [['start', 'start']] })

    const saved = await flows.drafts.save(flow.id, dangling, flow.draftRevision)

    assert.equal(saved.outcome, 'saved')
    assert.isTrue(saved.outcome === 'saved' && saved.problems.length > 0)
    assert.equal((await flows.publish(flow.id)).outcome, 'invalid')
  })

  test('publishing a draft whose logic did not change makes no version', async ({ assert }) => {
    const { flows } = flowsApp
    const { flowId, version } = await flowsApp.published(says('Same?'))
    const flow = await flows.flows.get(flowId)

    const moved: FlowGraph = {
      ...flow.draft,
      nodes: flow.draft.nodes.map(node => ({ ...node, position: { x: 7, y: 7 } })),
    }

    await flows.drafts.save(flowId, moved, flow.draftRevision)

    assert.containsSubset(await flows.publish(flowId), {
      outcome: 'unchanged',
      version: { id: version.id, number: 1 },
    })
    assert.lengthOf(await flows.versions.list(flowId), 1)
  })

  test('publish refuses a handoff to a queue that does not exist', async ({ assert }) => {
    const { flows } = flowsApp
    const flow = await flows.flows.create('unknown queue')

    await flows.drafts.save(
      flow.id,
      graph({
        nodes: [
          ['start', 'start'],
          ['away', 'handoff', { target: 'queue', queueId: 987_654 }],
        ],
        edges: [['start', 'default', 'away']],
      }),
      flow.draftRevision,
    )

    const result = await flows.publish(flow.id)

    assert.containsSubset(result, {
      outcome: 'invalid',
      problems: [{ code: 'unknown_reference', nodeId: 'away', field: 'queueId' }],
    })
    assert.lengthOf(await flows.versions.list(flow.id), 0)
  })

  test('publish refuses a close reason the inbox does not have', async ({ assert }) => {
    const { flows } = flowsApp
    const flow = await flows.flows.create('bad reason')

    const closing = (reason: string) =>
      graph({
        nodes: [
          ['start', 'start'],
          ['bye', 'close', { reason }],
        ],
        edges: [['start', 'default', 'bye']],
      })

    await flows.drafts.save(flow.id, closing('opted_out'), flow.draftRevision)

    assert.containsSubset(await flows.publish(flow.id), {
      outcome: 'invalid',
      problems: [{ code: 'unknown_reference', nodeId: 'bye', field: 'reason' }],
    })

    await flows.drafts.save(flow.id, closing('bot_completed'), flow.draftRevision + 1)

    assert.equal((await flows.publish(flow.id)).outcome, 'published')
  })

  test('publish refuses what the host refuses', async ({ assert }) => {
    const { flows } = flowsApp
    const flow = await flows.flows.create('refused')

    await flows.drafts.save(flow.id, says('Hi?'), flow.draftRevision)
    refusedFlows.add(flow.id)

    try {
      assert.containsSubset(await flows.publish(flow.id), {
        outcome: 'invalid',
        problems: [{ detail: 'refused by host' }],
      })
    } finally {
      refusedFlows.delete(flow.id)
    }
  })

  test('an old version restored into the draft publishes as a new version', async ({ assert }) => {
    const { flows } = flowsApp
    const { flowId, version: first } = await flowsApp.published(says('First?'))
    const flow = await flows.flows.get(flowId)

    await flows.drafts.save(flowId, says('Second?'), flow.draftRevision)
    await flows.publish(flowId)

    const stale = await flows.versions.restore(flowId, first.id, flow.draftRevision)

    assert.equal(stale.outcome, 'stale')

    const restored = await flows.versions.restore(flowId, first.id, flow.draftRevision + 1)

    assert.equal(restored.outcome, 'saved')

    const third = await flows.publish(flowId)

    assert.containsSubset(third, { outcome: 'published', version: { number: 3 } })
    assert.deepEqual(
      (await flows.versions.list(flowId)).map(({ number, hash }) => ({ number, hash })),
      [
        { number: 3, hash: first.hash },
        { number: 2, hash: (await flows.versions.list(flowId))[1].hash },
        { number: 1, hash: first.hash },
      ],
    )
  })
})

test.group('activating flows', group => {
  let flowsApp: FlowsApp

  group.setup(async () => {
    flowsApp = await bootFlows()

    return () => flowsApp.terminate()
  })

  group.each.setup(() => fake.reset())

  const sent = () => fake.sends.map(({ message }) => message.content.text)

  async function ticketRow(id: TicketId) {
    return flowsApp.db.from('inbox_tickets').where('id', id).firstOrFail()
  }

  test('the bot runs the flow of the highest-priority binding whose scope and condition hold', async ({
    assert,
  }) => {
    const { flows } = flowsApp
    const channel = await channelIn(flowsApp.app, 'flows')
    const elsewhere = await channelIn(flowsApp.app, 'flows')
    const low = await flowsApp.published(says('Low?'))
    const high = await flowsApp.published(says('High?'))
    const pricing = await flowsApp.published(says('Which plan?'))
    const other = await flowsApp.published(says('Other channel?'))

    await flows.bindings.set(low.flowId, [
      { priority: 0, channelId: channel.channelId, queueId: null, condition: null },
    ])
    await flows.bindings.set(high.flowId, [
      { priority: 10, channelId: channel.channelId, queueId: channel.queueId, condition: null },
    ])
    await flows.bindings.set(pricing.flowId, [
      {
        priority: 20,
        channelId: channel.channelId,
        queueId: null,
        condition: { variable: 'message', operator: 'contains', value: 'price' },
      },
    ])
    await flows.bindings.set(other.flowId, [
      { priority: 99, channelId: elsewhere.channelId, queueId: null, condition: null },
    ])

    await channel.write('hello')

    assert.deepEqual(sent(), ['High?'])

    const second = await channelIn(flowsApp.app, 'flows')

    await flows.bindings.set(high.flowId, [
      { priority: 10, channelId: null, queueId: elsewhere.queueId, condition: null },
    ])
    await flows.bindings.set(low.flowId, [
      { priority: 0, channelId: second.channelId, queueId: null, condition: null },
    ])
    await flows.bindings.set(pricing.flowId, [
      {
        priority: 20,
        channelId: second.channelId,
        queueId: null,
        condition: { variable: 'message', operator: 'contains', value: 'price' },
      },
    ])

    await second.write('hello')

    const third = await channelIn(flowsApp.app, 'flows')

    await flows.bindings.set(pricing.flowId, [
      {
        priority: 20,
        channelId: third.channelId,
        queueId: null,
        condition: { variable: 'message', operator: 'contains', value: 'price' },
      },
    ])

    await third.write('what is the PRICE?')

    assert.deepEqual(sent(), ['High?', 'Low?', 'Which plan?'])
  })

  test('a binding condition must fit its variable', async ({ assert }) => {
    const { flows } = flowsApp
    const { flowId } = await flowsApp.published(says('Hi?'))

    const result = await flows.bindings.set(flowId, [
      {
        priority: 0,
        channelId: null,
        queueId: null,
        condition: { variable: 'message', operator: 'gt', value: '3' },
      },
    ])

    assert.equal(result.outcome, 'invalid')
    assert.deepEqual(await flows.bindings.list(flowId), [])
  })

  test('bindings set at once leave one of the sets, not their union', async ({ assert }) => {
    const { flows } = flowsApp
    const { flowId } = await flowsApp.published(says('Hi?'))
    const channels = await Promise.all([1, 2, 3, 4].map(() => channelIn(flowsApp.app, 'flows')))

    const results = await Promise.all(
      channels.map(({ channelId }) =>
        flows.bindings.set(flowId, [{ priority: 0, channelId, queueId: null, condition: null }]),
      ),
    )

    const listed = await flows.bindings.list(flowId)

    assert.isTrue(results.every(result => result.outcome === 'saved'))
    assert.lengthOf(listed, 1)
    assert.oneOf(
      listed[0]?.channelId,
      channels.map(({ channelId }) => channelId),
    )
  })

  test('the bot returns a ticket no binding wants', async ({ assert }) => {
    const channel = await channelIn(flowsApp.app, 'flows')

    await channel.write('hello')

    assert.deepEqual(sent(), [])
    assert.deepInclude(await ticketRow(await channel.openTicket()), {
      status: 'queued',
      assignee_id: null,
    })
  })

  test('a manual start runs a flow on a queued ticket, and another one replaces it', async ({
    assert,
  }) => {
    const { flows } = flowsApp
    const channel = await channelIn(flowsApp.app, 'fake')
    const first = await flowsApp.published(says('First flow?'))
    const second = await flowsApp.published(says('Second flow?'))

    await channel.write('hello')

    const ticketId = await channel.openTicket()

    assert.containsSubset(await flows.start(ticketId, first.flowId, SYSTEM), {
      outcome: 'started',
      run: { flowId: first.flowId, bindingId: null, status: 'running' },
    })
    assert.deepEqual(sent(), ['First flow?'])

    assert.equal((await flows.start(ticketId, second.flowId, SYSTEM)).outcome, 'started')
    assert.deepEqual(sent(), ['First flow?', 'Second flow?'])

    const runs = await flows.runs.forTicket(ticketId)

    assert.containsSubset(runs, [
      { flowId: first.flowId, status: 'ended', reason: 'replaced' },
      { flowId: second.flowId, status: 'running' },
    ])
  })

  test('a manual start of a flow with no published version is refused', async ({ assert }) => {
    const { flows } = flowsApp
    const channel = await channelIn(flowsApp.app, 'fake')
    const draft = await flows.flows.create('unpublished')

    await channel.write('hello')

    assert.deepEqual(await flows.start(await channel.openTicket(), draft.id, SYSTEM), {
      outcome: 'rejected',
      reason: 'not_published',
    })
  })

  test('stopping a run returns the ticket, and the bindings leave it alone after', async ({
    assert,
  }) => {
    const { flows } = flowsApp
    const channel = await channelIn(flowsApp.app, 'flows')
    const { flowId } = await flowsApp.published(says('Name?'))
    const inbox = await flowsApp.app.container.make('inbox')

    await flowsApp.bind(flowId, channel.channelId)
    await channel.write('hello')

    const ticketId = await channel.openTicket()

    assert.containsSubset(await flows.stop(ticketId, SYSTEM), {
      outcome: 'stopped',
      run: { status: 'ended', reason: 'stopped' },
    })
    assert.deepInclude(await ticketRow(ticketId), { status: 'queued', assignee_id: null })
    assert.deepEqual(await flows.stop(ticketId, SYSTEM), { outcome: 'not_running' })

    const bot = await inbox.attendants.bot('flows')

    await inbox.tickets.apply(ticketId, { gesture: 'assign', to: bot.id }, SYSTEM)

    assert.deepEqual(sent(), ['Name?'])
    assert.lengthOf(await flows.runs.forTicket(ticketId), 1)
    assert.deepInclude(await ticketRow(ticketId), { status: 'queued' })
  })
})
