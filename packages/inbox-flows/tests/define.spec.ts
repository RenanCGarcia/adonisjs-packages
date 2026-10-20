import { test } from '@japa/runner'
import vine from '@vinejs/vine'

import { builtins, defineEffect, defineNode, defineNodes, type EffectsOf } from '../index.ts'
import { Conversation, Discard, compiled, graph, said } from './helpers.ts'

/**
 * At version 2: version 1 called `prompt` `question`.
 */
const survey = defineNode({
  type: 'survey',
  typeVersion: 2,
  config: vine.object({
    prompt: vine.string().maxLength(200),
    variable: vine.string(),
    scale: vine.enum(['stars', 'numbers']),
    anonymous: vine.boolean(),
    note: vine.string().nullable(),
    max: vine.number().min(1).max(10).optional(),
  }),
  defaults: { prompt: 'Rate us', variable: 'score', scale: 'stars', anonymous: false, note: null },
  fields: {
    prompt: { label: 'Prompt', binds: 'template' },
    variable: { label: 'Save as', binds: { writes: ['number'] } },
    scale: { label: 'Scale', widget: 'select' },
  },
  ports: [{ id: 'rated' }, { id: 'skipped', label: 'Skipped', whileSet: 'max' }],
  effect: defineEffect({
    payload: vine.object({ score: vine.number() }),
    delivery: 'after_commit',
    handler: async () => ({ default: Discard }),
  }),
  upgrade: (data, from) => {
    const { question, ...rest } = data

    return from === 1 ? { ...rest, prompt: question ?? '' } : data
  },
  ui: { label: 'Survey', category: 'Capture', icon: 'star', summary: '{{prompt}}' },
  enter: ({ config }) => ({ say: [config.prompt], wait: { for: 'message' } }),
  resume: (_scope, input) => {
    const score = input.kind === 'message' ? Number(input.text) : Number.NaN

    return Number.isFinite(score)
      ? { go: 'rated', set: { variable: { type: 'number', value: score } }, effect: { score } }
      : { go: 'rated' }
  },
})

const nodes = defineNodes([...builtins, survey])

test.group('catalog', () => {
  test('describes a custom node as plain JSON, with its JSON Schema and field hints', ({
    assert,
  }) => {
    const entry = nodes.catalog.nodes.find(({ type }) => type === 'survey')

    assert.deepEqual(entry, {
      type: 'survey',
      typeVersion: 2,
      upgradable: true,
      label: 'Survey',
      category: 'Capture',
      icon: 'star',
      summary: '{{prompt}}',
      ports: [{ id: 'rated' }, { id: 'skipped', label: 'Skipped', whileSet: 'max' }],
      entry: false,
      terminal: false,
      waits: true,
      effect: { delivery: 'after_commit' },
      defaults: {
        prompt: 'Rate us',
        variable: 'score',
        scale: 'stars',
        anonymous: false,
        note: null,
      },
      schema: {
        type: 'object',
        properties: {
          prompt: {
            'type': 'string',
            'maxLength': 200,
            'x-ui': { label: 'Prompt', binds: 'template' },
          },
          variable: {
            'type': 'string',
            'x-ui': { label: 'Save as', binds: { writes: ['number'] } },
          },
          scale: {
            'type': 'string',
            'enum': ['stars', 'numbers'],
            'x-ui': { label: 'Scale', widget: 'select' },
          },
          anonymous: { type: 'boolean' },
          note: { type: ['string', 'null'] },
          max: { type: 'number', minimum: 1, maximum: 10 },
        },
        required: ['prompt', 'variable', 'scale', 'anonymous', 'note'],
        additionalProperties: false,
      },
    })
    assert.deepEqual(JSON.parse(JSON.stringify(nodes.catalog)), nodes.catalog)
  })

  test('marks the start, the terminals and the nodes that wait', ({ assert }) => {
    const flags = Object.fromEntries(
      nodes.catalog.nodes.map(({ type, entry, terminal, waits }) => [
        type,
        { entry, terminal, waits },
      ]),
    )

    assert.deepEqual(flags.start, { entry: true, terminal: false, waits: false })
    assert.deepEqual(flags.handoff, { entry: false, terminal: true, waits: false })
    assert.deepEqual(flags.question, { entry: false, terminal: false, waits: true })
    assert.deepEqual(flags.delay, { entry: false, terminal: false, waits: true })
  })

  test('lists the operators per variable type', ({ assert }) => {
    assert.deepInclude(nodes.catalog.operators.text, { id: 'contains', operand: true })
    assert.deepInclude(nodes.catalog.operators.number, { id: 'lt', operand: true })
    assert.notDeepInclude(nodes.catalog.operators.boolean, { id: 'contains', operand: true })
  })

  test('derives the effects from the nodes that declare one', ({ assert }) => {
    assert.deepEqual([...nodes.effects.keys()], ['survey'])
    assert.equal(nodes.effects.get('survey')?.delivery, 'after_commit')

    const payload: EffectsOf<typeof nodes.nodes>['survey'] = { score: 5 }

    assert.equal(payload.score, 5)
  })
})

test.group('upgrade', () => {
  const v1 = graph({
    variables: [{ name: 'score', type: 'number' }],
    nodes: [
      ['s', 'start'],
      [
        'r',
        'survey',
        { question: 'How was it?', variable: 'score', scale: 'stars', anonymous: true, note: null },
      ],
      ['e', 'end'],
    ],
    edges: [
      ['s', 'default', 'r'],
      ['r', 'rated', 'e'],
    ],
  })

  test('brings old node data to the current version', ({ assert }) => {
    const upgraded = nodes.upgrade(v1)

    assert.containsSubset(upgraded.nodes[1], {
      typeVersion: 2,
      data: { prompt: 'How was it?', variable: 'score' },
    })
    assert.notProperty(upgraded.nodes[1].data, 'question')
    assert.deepEqual(v1.nodes[1].typeVersion, 1)
  })

  test('a graph pinned at an old version still compiles and runs', async ({ assert }) => {
    const run = new Conversation(await compiled(v1, nodes))

    assert.deepEqual(said(run.turn({ kind: 'assigned' })), ['How was it?'])

    const done = run.write('4')

    assert.containsSubset(done, {
      kind: 'end',
      effects: [{ node: 'r', type: 'survey', delivery: 'after_commit', payload: { score: 4 } }],
    })
    assert.deepEqual(run.state.vars, { score: { type: 'number', value: 4 } })
  })
})

test.group('defineNode / types', () => {
  const config = vine.object({ variable: vine.string(), source: vine.string() })
  const defaults = { variable: 'email', source: 'name' }
  const ui = { label: 'Ask email', category: 'Capture' }
  const ports = [{ id: 'valid' }, { id: 'invalid' }] as const

  const fields = {
    variable: { label: 'Save as', binds: { writes: ['text'] } },
    source: { label: 'Greet', binds: { reads: ['text'] } },
  } as const

  const effect = defineEffect({
    payload: vine.object({ tag: vine.string() }),
    delivery: 'after_commit',
    handler: async () => ({ default: Discard }),
  })

  test('go names a port of the node', ({ assert }) => {
    const node = defineNode({
      type: 'go_typo',
      typeVersion: 1,
      config,
      defaults,
      fields,
      ports,
      ui,
      // @ts-expect-error `timeout` is not a port of this node.
      execute: () => ({
        go: 'timeout',
      }),
    })

    assert.equal(node.type, 'go_typo')
  })

  test('set writes only the fields that bind a write, with a value of their type', ({ assert }) => {
    const undeclared = defineNode({
      type: 'set_undeclared',
      typeVersion: 1,
      config,
      defaults,
      fields,
      ports,
      ui,
      // @ts-expect-error `email` is no field of this node that binds a write.
      execute: () => ({
        go: 'valid',
        set: {
          email: { type: 'text', value: 'ana@x.io' },
        },
      }),
    })

    const reads = defineNode({
      type: 'set_read_field',
      typeVersion: 1,
      config,
      defaults,
      fields,
      ports,
      ui,
      // @ts-expect-error `source` binds a read, so it can't be set.
      execute: () => ({
        go: 'valid',
        set: {
          source: { type: 'text', value: 'x' },
        },
      }),
    })

    const mistyped = defineNode({
      type: 'set_mistyped',
      typeVersion: 1,
      config,
      defaults,
      fields,
      ports,
      ui,
      // @ts-expect-error `variable` binds a text variable.
      execute: () => ({
        go: 'valid',
        set: {
          variable: { type: 'number', value: 1 },
        },
      }),
    })

    assert.deepEqual(
      [undeclared.type, reads.type, mistyped.type],
      ['set_undeclared', 'set_read_field', 'set_mistyped'],
    )
  })

  test('read takes only the fields that bind a read', ({ assert }) => {
    const node = defineNode({
      type: 'read_write_field',
      typeVersion: 1,
      config,
      defaults,
      fields,
      ports,
      ui,
      execute: ({ read }) => ({
        go: 'valid',
        // @ts-expect-error `variable` binds a write, not a read.
        say: [read('variable')?.type ?? ''],
      }),
    })

    assert.equal(node.type, 'read_write_field')
  })

  test('the effect matches the payload its node declares', ({ assert }) => {
    const node = defineNode({
      type: 'effect_typo',
      typeVersion: 1,
      config,
      defaults,
      fields,
      ports,
      effect,
      ui,
      // @ts-expect-error the payload has a `tag`, not a `label`.
      execute: () => ({
        go: 'valid',
        effect: { label: 'lead' },
      }),
    })

    assert.equal(node.type, 'effect_typo')
  })

  test('the handler matches the delivery and the payload of its effect', ({ assert }) => {
    class Deliver {
      async deliver(_payload: { tag: string }) {}
    }

    class ApplyCount {
      async apply(_trx: never, _payload: { count: number }) {}
    }

    const delivered = defineEffect({
      payload: vine.object({ tag: vine.string() }),
      delivery: 'after_commit',
      handler: async () => ({ default: Deliver }),
    })

    // @ts-expect-error an in-transaction effect needs `apply`, not `deliver`.
    defineEffect({
      payload: vine.object({ tag: vine.string() }),
      delivery: 'in_transaction',
      handler: async () => ({ default: Deliver }),
    })

    defineEffect({
      payload: vine.object({ tag: vine.string() }),
      delivery: 'in_transaction',
      // @ts-expect-error the payload has a `tag`, not a `count`.
      handler: async () => ({ default: ApplyCount }),
    })

    assert.equal(delivered.delivery, 'after_commit')
  })

  test('a node that never waits cannot ask to wait', ({ assert }) => {
    const node = defineNode({
      type: 'greet',
      typeVersion: 1,
      config,
      defaults,
      ports,
      ui,
      // @ts-expect-error `execute` moves on or ends; only `enter` with `resume` may wait.
      execute: () => ({ wait: { for: 'message' } }),
    })

    assert.equal(node.type, 'greet')
  })

  test('a well-typed node compiles', ({ assert }) => {
    const node = defineNode({
      type: 'ask_email',
      typeVersion: 1,
      config,
      defaults,
      fields,
      ports,
      effect,
      ui,
      enter: ({ read }) => ({ say: [read('source')?.type ?? ''], wait: { for: 'message' } }),
      resume: (_scope, input) =>
        input.kind === 'message' && input.text.includes('@')
          ? {
              go: 'valid',
              set: { variable: { type: 'text', value: input.text } },
              effect: { tag: 'lead' },
            }
          : { go: 'invalid' },
    })

    assert.equal(node.type, 'ask_email')
  })
})
