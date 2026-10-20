import { test } from '@japa/runner'
import type { QueueId, TicketId } from '@enzopita/adonisjs-inbox'
import { channelIn, eventually } from '@enzopita/adonisjs-inbox/testing'

import { graph } from './helpers.ts'
import { bootFlows, fake, SYSTEM, type FlowsApp } from './playground.ts'

/**
 * Asks the age as a number, then transfers adults to `sales` and returns the rest.
 */
function screening(sales: QueueId, ask = 'How old are you?') {
  return graph({
    variables: [{ name: 'age', type: 'number' }],
    nodes: [
      ['start', 'start'],
      ['ask', 'question', { text: ask, variable: 'age', capture: 'number', retries: 1 }],
      ['adult', 'condition', { variable: 'age', operator: 'gte', value: '18' }],
      ['sales', 'handoff', { target: 'queue', queueId: sales, text: 'Sales will help you.' }],
      ['minor', 'end'],
    ],
    edges: [
      ['start', 'default', 'ask'],
      ['ask', 'answered', 'adult'],
      ['adult', 'true', 'sales'],
      ['adult', 'false', 'minor'],
    ],
  })
}

test.group('flow runs', group => {
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

  async function newQueue(name: string) {
    const inbox = await flowsApp.app.container.make('inbox')
    const queue = await (await inbox.model('queue')).create({ name })

    return queue.id
  }

  test('a contact answers a question and is handed to the queue its answer picks', async ({
    assert,
  }) => {
    const sales = await newQueue('sales')
    const { flowId, version } = await flowsApp.published(screening(sales))
    const channel = await channelIn(flowsApp.app, 'flows')

    await flowsApp.bind(flowId, channel.channelId)
    await channel.write('hi')

    const ticketId = await channel.openTicket()

    assert.deepEqual(sent(), ['How old are you?'])

    await channel.write('forty')

    assert.deepEqual(sent(), ['How old are you?', 'How old are you?'])

    await channel.write('42')

    assert.deepEqual(sent(), ['How old are you?', 'How old are you?', 'Sales will help you.'])
    assert.deepInclude(await ticketRow(ticketId), { status: 'queued', queue_id: sales })

    const [run] = await flowsApp.flows.runs.forTicket(ticketId)

    assert.containsSubset(run, {
      flowId,
      versionId: version.id,
      status: 'ended',
      reason: 'handed_off',
      vars: { age: { type: 'number', value: 42 } },
    })
  })

  test('a run stays on the version it started on when a new one is published', async ({
    assert,
  }) => {
    const sales = await newQueue('sales')
    const { flowId, version } = await flowsApp.published(screening(sales, 'Your age?'))
    const channel = await channelIn(flowsApp.app, 'flows')

    await flowsApp.bind(flowId, channel.channelId)
    await channel.write('hi')

    const ticketId = await channel.openTicket()
    const flow = await flowsApp.flows.flows.get(flowId)
    const draft = screening(sales, 'How old are you, please?')

    await flowsApp.flows.drafts.save(flowId, draft, flow.draftRevision)

    const second = await flowsApp.flows.publish(flowId)

    assert.equal(second.outcome, 'published', JSON.stringify(second))

    await channel.write('seven')

    assert.deepEqual(sent(), ['Your age?', 'Your age?'])

    const [run] = await flowsApp.flows.runs.forTicket(ticketId)

    assert.equal(run.versionId, version.id)

    const other = await channelIn(flowsApp.app, 'flows')

    await flowsApp.bind(flowId, other.channelId)
    await other.write('hi')

    assert.equal(sent().at(-1), 'How old are you, please?')
  })

  test('a person taking the ticket ends the run, and the flow never takes it back', async ({
    assert,
  }) => {
    const sales = await newQueue('sales')
    const { flowId } = await flowsApp.published(screening(sales))
    const channel = await channelIn(flowsApp.app, 'flows')
    const inbox = await flowsApp.app.container.make('inbox')

    await flowsApp.bind(flowId, channel.channelId)
    await channel.write('hi')

    const ticketId = await channel.openTicket()
    const agent = await inbox.attendants.forUser(4242)

    await inbox.queues.addMember(channel.queueId, agent)

    const reply = await inbox.messages.send(ticketId, { kind: 'text', text: 'I got this' }, agent)

    assert.equal(reply.outcome, 'queued', JSON.stringify(reply))

    await channel.write('42')

    assert.deepEqual(sent(), ['How old are you?', 'I got this'])

    const runs = await flowsApp.flows.runs.forTicket(ticketId)

    assert.lengthOf(runs, 1)
    assert.containsSubset(runs[0], { status: 'ended', reason: 'taken_over' })

    await inbox.tickets.apply(ticketId, { gesture: 'return' }, agent)

    const bot = await inbox.attendants.bot('flows')
    const handed = await inbox.tickets.apply(ticketId, { gesture: 'assign', to: bot.id }, SYSTEM)

    assert.equal(handed.outcome, 'changed')
    assert.deepEqual(sent(), ['How old are you?', 'I got this'])
    assert.lengthOf(await flowsApp.flows.runs.forTicket(ticketId), 1)
    assert.deepInclude(await ticketRow(ticketId), { status: 'queued', assignee_id: null })
  })

  test('a ticket that left the bot and came back unnoticed ends the run it had', async ({
    assert,
  }) => {
    const sales = await newQueue('sales')
    const { flowId } = await flowsApp.published(screening(sales))
    const channel = await channelIn(flowsApp.app, 'flows')
    const inbox = await flowsApp.app.container.make('inbox')
    const emitter = await flowsApp.app.container.make('emitter')

    await flowsApp.bind(flowId, channel.channelId)
    await channel.write('hi')

    const ticketId = await channel.openTicket()
    const bot = await inbox.attendants.bot('flows')

    // A lost ticket_changed event, so only the bot's turn can tell the run is over.
    emitter.fake(['inbox:ticket_changed'])

    try {
      await inbox.tickets.apply(ticketId, { gesture: 'return' }, SYSTEM)
      await inbox.tickets.apply(ticketId, { gesture: 'assign', to: bot.id }, SYSTEM)
    } finally {
      emitter.restore()
    }

    assert.deepEqual(sent(), ['How old are you?'])
    assert.containsSubset(await flowsApp.flows.runs.forTicket(ticketId), [
      { status: 'ended', reason: 'taken_over' },
    ])
    assert.deepInclude(await ticketRow(ticketId), { status: 'queued', assignee_id: null })
  })

  test('a delay wakes the run once it passed, and a repeated wake does nothing', async ({
    assert,
  }) => {
    const { flowId } = await flowsApp.published(
      graph({
        variables: [{ name: 'answer', type: 'text' }],
        nodes: [
          ['start', 'start'],
          ['wait', 'delay', { seconds: 1 }],
          [
            'ask',
            'question',
            { text: 'Still there?', variable: 'answer', capture: 'text', retries: 0 },
          ],
          ['done', 'end'],
        ],
        edges: [
          ['start', 'default', 'wait'],
          ['wait', 'default', 'ask'],
          ['ask', 'answered', 'done'],
        ],
      }),
    )

    const channel = await channelIn(flowsApp.app, 'flows')
    const inbox = await flowsApp.app.container.make('inbox')

    await flowsApp.bind(flowId, channel.channelId)
    await channel.write('hi')

    const ticketId = await channel.openTicket()
    const [delayed] = await flowsApp.flows.runs.forTicket(ticketId)

    assert.deepEqual(sent(), [])
    assert.equal(delayed.status, 'running')

    if (delayed.status !== 'running') return

    const token = `${delayed.id}:${delayed.wait.waiting.token}`

    await inbox.tickets.wake(ticketId, 'flows', token)

    assert.deepEqual(sent(), [], 'a wake before the delay passed is early')

    await eventually(() => sent().length > 0)

    assert.deepEqual(sent(), ['Still there?'])

    const [asking] = await flowsApp.flows.runs.forTicket(ticketId)

    await inbox.tickets.wake(ticketId, 'flows', token)

    const [after] = await flowsApp.flows.runs.forTicket(ticketId)

    assert.deepEqual(sent(), ['Still there?'])
    assert.deepEqual(after, asking)
  })
})
