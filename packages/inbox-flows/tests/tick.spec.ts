import { execFile } from 'node:child_process'
import { setTimeout as sleep } from 'node:timers/promises'
import { promisify } from 'node:util'

import { test } from '@japa/runner'
import type { TaskDriverFactory, TicketId } from '@enzopita/adonisjs-inbox'
import { channelIn } from '@enzopita/adonisjs-inbox/testing'

import { graph } from './helpers.ts'
import { bootFlows, fake, playground, type FlowsApp } from './playground.ts'

const run = promisify(execFile)

/**
 * Runs a task right away and loses every delayed one, as `tasks.inline()` does across a
 * restart.
 */
const losingDelays: TaskDriverFactory = runTask => ({
  async enqueue(task, delayMs) {
    if (delayMs === 0) await runTask(task)
  },
  close() {},
})

const delayed = graph({
  variables: [{ name: 'answer', type: 'text' }],
  nodes: [
    ['start', 'start'],
    ['wait', 'delay', { seconds: 1 }],
    ['ask', 'question', { text: 'Back?', variable: 'answer', capture: 'text', retries: 0 }],
    ['done', 'end'],
  ],
  edges: [
    ['start', 'default', 'wait'],
    ['wait', 'default', 'ask'],
    ['ask', 'answered', 'done'],
  ],
})

test.group('flows:tick', group => {
  let flowsApp: FlowsApp

  group.setup(async () => {
    flowsApp = await bootFlows({ tasks: losingDelays })

    return () => flowsApp.terminate()
  })

  group.each.setup(() => fake.reset())

  const sent = () => fake.sends.map(({ message }) => message.content.text)

  async function waitingOnADelay() {
    const { flowId } = await flowsApp.published(delayed)
    const channel = await channelIn(flowsApp.app, 'flows')

    await flowsApp.bind(flowId, channel.channelId)
    await channel.write('hi')

    return channel.openTicket()
  }

  async function bodies(ticketId: TicketId) {
    const rows = await flowsApp.db
      .from('inbox_messages')
      .where('ticket_id', ticketId)
      .where('direction', 'outbound')
      .select('body')

    return rows.map(({ body }) => body)
  }

  test('a tick sends a wake the process lost, and a second tick changes nothing', async ({
    assert,
  }) => {
    const ticketId = await waitingOnADelay()

    await flowsApp.flows.tick()

    assert.deepEqual(sent(), [], 'the delay has not passed')

    await sleep(1100)
    await flowsApp.flows.tick()

    assert.deepEqual(sent(), ['Back?'])

    const runs = await flowsApp.flows.runs.forTicket(ticketId)

    await flowsApp.flows.tick()

    assert.deepEqual(sent(), ['Back?'])
    assert.deepEqual(await flowsApp.flows.runs.forTicket(ticketId), runs)
  })

  test('node ace flows:tick in the playground does the same, once', async ({ assert }) => {
    const ticketId = await waitingOnADelay()

    await sleep(1100)

    const first = await run('node', ['ace', 'flows:tick'], { cwd: playground })
    const runs = await flowsApp.flows.runs.forTicket(ticketId)
    const second = await run('node', ['ace', 'flows:tick'], { cwd: playground })

    assert.deepEqual(await bodies(ticketId), ['Back?'])
    assert.containsSubset(runs, [{ status: 'running', wait: { waiting: { node: 'ask' } } }])
    assert.deepEqual(await flowsApp.flows.runs.forTicket(ticketId), runs)
    assert.match(first.stdout, /woke [1-9]\d* runs/)
    assert.include(second.stdout, 'woke 0 runs')
  }).timeout(60_000)
})
