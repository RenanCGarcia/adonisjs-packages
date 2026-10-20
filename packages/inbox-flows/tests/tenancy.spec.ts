import { AsyncLocalStorage } from 'node:async_hooks'
import { setTimeout as sleep } from 'node:timers/promises'

import { beforeCreate, column } from '@adonisjs/lucid/orm'
import type { LucidModel } from '@adonisjs/lucid/types/model'
import { test } from '@japa/runner'
import type { TaskDriverFactory, TicketId } from '@enzopita/adonisjs-inbox'
import { channelIn, modelsIn } from '@enzopita/adonisjs-inbox/testing'

import type { FlowGraph, JsonObject } from '../index.ts'
import { graph } from './helpers.ts'
import { bootFlows, fake, flowModelsIn, playground, type FlowsApp } from './playground.ts'

/**
 * Runs a task right away and loses every delayed one, so only a tick sends a wake.
 */
const losingDelays: TaskDriverFactory = runTask => ({
  async enqueue(task, delayMs) {
    if (delayMs === 0) await runTask(task)
  },
  close() {},
})

/**
 * A host that keeps a tenant on its rows: the tenant of the request in context fills the
 * `tenant_id` of a row it creates, unless the row already has one.
 */
const current = new AsyncLocalStorage<number>()

function withTenant<T>(tenantId: number, work: () => T) {
  return current.run(tenantId, work)
}

const TENANTED = {
  channel: 'inbox_channels',
  channelEvent: 'inbox_channel_events',
  contact: 'inbox_contacts',
  conversation: 'inbox_conversations',
  ticket: 'inbox_tickets',
  ticketEvent: 'inbox_ticket_events',
  message: 'inbox_messages',
  flow: 'inbox_flows',
  flowBinding: 'inbox_flow_bindings',
  flowRun: 'inbox_flow_runs',
  flowEffect: 'inbox_flow_effects',
} as const

type Role = keyof typeof TENANTED

const loaders = { ...modelsIn(playground), ...flowModelsIn(playground) }

/**
 * The model of `role` with the host's tenant column and the create hook that fills it.
 */
function tenanted(role: Role) {
  const load = async () => {
    const { default: Base }: { default: LucidModel } = await loaders[role]()

    class Tenanted extends Base {
      static table = Base.table

      @column()
      declare tenantId: number | null

      @beforeCreate()
      static stamp(row: Tenanted) {
        row.tenantId ??= current.getStore() ?? null
      }
    }

    return { default: Tenanted }
  }

  let loaded: ReturnType<typeof load> | undefined

  return () => (loaded ??= load())
}

/**
 * A flow that runs `first`, then asks `text` and waits for the answer.
 */
function asks(text: string, first: readonly [type: string, data: JsonObject]): FlowGraph {
  return graph({
    variables: [{ name: 'answer', type: 'text' }],
    nodes: [
      ['start', 'start'],
      ['first', ...first],
      ['ask', 'question', { text, variable: 'answer', capture: 'text', retries: 0 }],
      ['done', 'end'],
    ],
    edges: [
      ['start', 'default', 'first'],
      ['first', 'default', 'ask'],
      ['ask', 'answered', 'done'],
    ],
  })
}

test.group('flows across tenants', group => {
  let flowsApp: FlowsApp
  let lastTenant = 0

  group.setup(async () => {
    flowsApp = await bootFlows({
      tasks: losingDelays,
      ownership: channel => ({ tenantId: channel.$attributes.tenantId }),
      // SAFETY: each role's model, with a column the inbox and the flows don't read.
      models: Object.fromEntries(
        Object.keys(TENANTED).map(role => [role, tenanted(role as Role)]),
      ) as Partial<typeof loaders>,
    })

    const schema = () => flowsApp.db.connection().schema

    for (const table of Object.values(TENANTED)) {
      if (!(await schema().hasColumn(table, 'tenant_id'))) {
        await schema().alterTable(table, columns => columns.integer('tenant_id').nullable())
      }
    }

    return async () => {
      // A catch-all binding left behind would take the tickets of the other specs.
      await flowsApp.db.from('inbox_flow_bindings').whereNotNull('tenant_id').delete()

      for (const table of Object.values(TENANTED)) {
        await schema().alterTable(table, columns => columns.dropColumn('tenant_id'))
      }

      await flowsApp.terminate()
    }
  })

  group.each.setup(() => fake.reset())

  const tenant = () => ++lastTenant

  /**
   * A flows channel and a published flow of the tenant, created as a request of its would.
   */
  function setUp(tenantId: number, flow: FlowGraph) {
    return withTenant(tenantId, async () => ({
      channel: await channelIn(flowsApp.app, 'flows'),
      ...(await flowsApp.published(flow)),
    }))
  }

  async function said(ticketId: TicketId) {
    const rows = await flowsApp.db
      .from('inbox_messages')
      .where('ticket_id', ticketId)
      .where('direction', 'outbound')
      .select('body')

    return rows.map(({ body }) => body)
  }

  /**
   * The tenants of the rows the inbox and the flows keep for the ticket, by table.
   */
  async function tenantsOf(ticketId: TicketId) {
    const tenantsIn = async (table: string) => [
      ...new Set(
        (await flowsApp.db.from(table).where('ticket_id', ticketId).select('tenant_id')).map(
          row => row.tenant_id,
        ),
      ),
    ]

    return {
      runs: await tenantsIn('inbox_flow_runs'),
      effects: await tenantsIn('inbox_flow_effects'),
      messages: await tenantsIn('inbox_messages'),
      ticketEvents: await tenantsIn('inbox_ticket_events'),
    }
  }

  test("a contact never runs another tenant's flow, even one bound to every channel", async ({
    assert,
  }) => {
    const [a, b] = [tenant(), tenant()]
    const theirs = await setUp(a, asks('From A?', ['notify', { text: 'A' }]))
    const ours = await setUp(b, asks('From B?', ['notify', { text: 'B' }]))

    await withTenant(a, () =>
      flowsApp.flows.bindings.set(theirs.flowId, [
        { priority: 10, channelId: null, queueId: null, condition: null },
      ]),
    )
    await withTenant(b, () => flowsApp.bind(ours.flowId, ours.channel.channelId))

    // A webhook: no tenant in context.
    await ours.channel.write('hello')

    const ticketId = await ours.channel.openTicket()
    const runs = await flowsApp.flows.runs.forTicket(ticketId)

    assert.deepEqual(await said(ticketId), ['From B?'])
    assert.deepEqual(
      runs.map(({ flowId }) => flowId),
      [ours.flowId],
    )
    assert.deepEqual(await tenantsOf(ticketId), {
      runs: [b],
      effects: [b],
      messages: [b],
      ticketEvents: [b],
    })
  })

  test('a tick wakes the runs of two tenants in one run, each in its own', async ({ assert }) => {
    const prepared = await Promise.all(
      [tenant(), tenant()].map(async tenantId => {
        const { channel, flowId } = await setUp(tenantId, asks('Back?', ['delay', { seconds: 1 }]))

        await withTenant(tenantId, () => flowsApp.bind(flowId, channel.channelId))
        await channel.write('hi')

        return { tenantId, ticketId: await channel.openTicket() }
      }),
    )

    await sleep(1100)
    await flowsApp.flows.tick()

    for (const { tenantId, ticketId } of prepared) {
      assert.deepEqual(await said(ticketId), ['Back?'])
      assert.deepEqual(await tenantsOf(ticketId), {
        runs: [tenantId],
        effects: [],
        messages: [tenantId],
        ticketEvents: [tenantId],
      })
    }
  })
})
