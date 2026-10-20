import type { TransactionClientContract } from '@adonisjs/lucid/types/database'
import type { LucidRow } from '@adonisjs/lucid/types/model'
import vine from '@vinejs/vine'
import {
  adapters,
  automations,
  defineConfig as defineInboxConfig,
  tasks,
  type Actor,
  type ChannelId,
  type Ownership,
  type TaskDriverFactory,
  type TicketId,
} from '@enzopita/adonisjs-inbox'
import { bootApp, FakeChannelAdapter, migrateApp, modelsIn } from '@enzopita/adonisjs-inbox/testing'

import {
  builtins,
  defineConfig,
  defineEffect,
  defineNode,
  defineNodes,
  type AfterCommitEffect,
  type EffectContext,
  type FlowsModels,
  type FlowGraph,
  type FlowId,
  type InTransactionEffect,
  type PublishCheck,
} from '../index.ts'
import type { InboxFlows } from '../src/inbox_flows.ts'

/**
 * A host app, set up by `node ace configure` for the inbox, then for the flows.
 */
export const fixture = new URL('fixtures/app/', import.meta.url)

export const SYSTEM: Actor = { kind: 'system', source: 'test' }

export const fake = new FakeChannelAdapter()

/**
 * What the effect handlers below did, and how often they should still fail.
 */
export const effects = {
  failNotes: 0,
  failDeliveries: 0,
  deliveries: new Array<{ text: string; idempotencyKey: string; attempt: number }>(),
  reset() {
    this.failNotes = 0
    this.failDeliveries = 0
    this.deliveries.length = 0
  },
}

/**
 * Writes its row first, so a failing call shows the turn's rollback took the row with it.
 */
class NoteEffect implements InTransactionEffect<{ text: string }> {
  async apply(trx: TransactionClientContract, payload: { text: string }, context: EffectContext) {
    await trx.table('flow_notes').insert({ ticket_id: context.ticketId, note: payload.text })

    if (effects.failNotes > 0) {
      effects.failNotes--
      throw new Error('the note failed')
    }
  }
}

class NotifyEffect implements AfterCommitEffect<{ text: string }> {
  async deliver(
    payload: { text: string },
    context: EffectContext & { idempotencyKey: string; attempt: number },
  ) {
    effects.deliveries.push({
      text: payload.text,
      idempotencyKey: context.idempotencyKey,
      attempt: context.attempt,
    })

    if (effects.failDeliveries > 0) {
      effects.failDeliveries--
      throw new Error('the remote side is down')
    }
  }
}

const note = defineNode({
  type: 'note',
  typeVersion: 1,
  config: vine.object({ text: vine.string() }),
  defaults: { text: '' },
  ports: [{ id: 'default' }],
  effect: defineEffect({
    payload: vine.object({ text: vine.string() }),
    delivery: 'in_transaction',
    handler: async () => ({ default: NoteEffect }),
  }),
  ui: { label: 'Note', category: 'Test' },
  execute: ({ config }) => ({ go: 'default', effect: { text: config.text } }),
})

const notify = defineNode({
  type: 'notify',
  typeVersion: 1,
  config: vine.object({ text: vine.string() }),
  defaults: { text: '' },
  ports: [{ id: 'default' }],
  effect: defineEffect({
    payload: vine.object({ text: vine.string() }),
    delivery: 'after_commit',
    handler: async () => ({ default: NotifyEffect }),
  }),
  ui: { label: 'Notify', category: 'Test' },
  execute: ({ config }) => ({ go: 'default', effect: { text: config.text } }),
})

export const MAX_STEPS = 12

/**
 * The flows models of an app laid out as `node ace configure` writes them.
 */
export function flowModelsIn(appRoot: URL): FlowsModels {
  const model = (path: string) => () => import(new URL(`app/models/inbox/${path}.ts`, appRoot).href)

  return {
    flow: model('flow'),
    flowVersion: model('flow_version'),
    flowBinding: model('flow_binding'),
    flowRun: model('flow_run'),
    flowEffect: model('flow_effect'),
  }
}

/**
 * The checks a host adds at publish, here refusing any flow named in `refused`.
 */
export const refusedFlows = new Set<number>()

const validatePublish = ({ flowId }: PublishCheck) =>
  refusedFlows.has(flowId)
    ? [{ code: 'node_rule' as const, severity: 'impediment' as const, detail: 'refused by host' }]
    : []

/**
 * The fixture booted in this process with the flows provider, the flows bot on `flows`
 * channels, the fake adapter, and the `note` and `notify` effect nodes.
 */
export async function bootFlows(
  options: {
    tasks?: TaskDriverFactory
    ownership?: (channel: LucidRow) => Ownership
    models?: Partial<ReturnType<typeof modelsIn> & FlowsModels>
  } = {},
) {
  await migrateApp(fixture)

  const app = await bootApp(
    fixture,
    defineInboxConfig({
      models: { ...modelsIn(fixture), ...options.models },
      bots: { flows: () => import('../src/bot.ts') },
      automations: [
        automations.assignOnOpen({
          bot: 'flows',
          when: ({ channel }) => channel.provider === 'flows',
        }),
      ],
      channels: { fake: adapters.fake(fake), flows: adapters.fake(fake) },
      tasks: options.tasks ?? tasks.inline(),
      ownership: options.ownership,
    }),
    {
      providers: [() => import('../providers/inbox_flows_provider.ts')],
      config: {
        inbox_flows: defineConfig({
          bot: 'flows',
          models: { ...flowModelsIn(fixture), ...options.models },
          nodes: defineNodes([...builtins, note, notify]),
          debounce: { milliseconds: 0 },
          maxSteps: MAX_STEPS,
          validatePublish,
        }),
      },
    },
  )

  const db = await app.container.make('lucid.db')

  await db.connection().schema.dropTableIfExists('flow_notes')
  await db.connection().schema.createTable('flow_notes', table => {
    table.increments('id')
    table.integer('ticket_id').notNullable()
    table.string('note').notNullable()
  })

  const flows: InboxFlows = await app.container.make('inboxFlows')

  return {
    app,
    flows,
    db,
    /**
     * A flow whose draft is `graph`, published as its first version.
     */
    async published(graph: FlowGraph) {
      const flow = await flows.flows.create('test flow')
      const saved = await flows.drafts.save(flow.id, graph, flow.draftRevision)

      if (saved.outcome !== 'saved') throw new Error(`the draft was ${saved.outcome}`)

      const result = await flows.publish(flow.id)

      if (result.outcome !== 'published') {
        throw new Error(`the publish was ${JSON.stringify(result)}`)
      }

      return { flowId: flow.id, version: result.version }
    },
    async bind(flowId: FlowId, channelId: ChannelId, priority = 0) {
      const result = await flows.bindings.set(flowId, [
        { priority, channelId, queueId: null, condition: null },
      ])

      if (result.outcome !== 'saved') throw new Error('the bindings were invalid')
    },
    async notes(ticketId: TicketId) {
      const rows = await db.from('flow_notes').where('ticket_id', ticketId).select('note')

      return rows.map(({ note: text }) => text)
    },
    async terminate() {
      await db.connection().schema.dropTableIfExists('flow_notes')
      await app.terminate()
    },
  }
}

export type FlowsApp = Awaited<ReturnType<typeof bootFlows>>
