import { readdir, readFile } from 'node:fs/promises'

import { test } from '@japa/runner'
import vine from '@vinejs/vine'

import {
  builtins,
  checkGraph,
  defineNode,
  defineNodes,
  graphHash,
  type Catalog,
  type FlowGraph,
  type Problem,
} from '../index.ts'
import { graph, registry } from './helpers.ts'

const askNumber = defineNode({
  type: 'ask_code',
  typeVersion: 1,
  config: vine.object({ variable: vine.string() }),
  defaults: { variable: '' },
  fields: { variable: { label: 'Save as', binds: { writes: ['text'] } } },
  ports: [{ id: 'default' }],
  ui: { label: 'Ask code', category: 'Capture' },
  enter: () => ({ wait: { for: 'message' } }),
  resume: ({ config: _config }, input) =>
    input.kind === 'message'
      ? { go: 'default', set: { variable: { type: 'text', value: input.text } } }
      : { go: 'default' },
})

const menu = defineNode({
  type: 'menu',
  typeVersion: 1,
  config: vine.object({
    options: vine.array(vine.object({ id: vine.string(), label: vine.string() })),
  }),
  defaults: { options: [] },
  ports: { from: 'options' },
  ui: { label: 'Menu', category: 'Capture' },
  enter: () => ({ wait: { for: 'message' } }),
  resume: ({ config }, input) => ({
    go:
      config.options.find(option => input.kind === 'message' && option.label === input.text)?.id ??
      'none',
  }),
})

const nodes = defineNodes([...builtins, askNumber, menu])
const catalog = nodes.catalog

const codes = (problems: Problem[]) => problems.map(({ code }) => code)

const linear = (): FlowGraph =>
  graph({
    nodes: [
      ['s', 'start'],
      ['m', 'message', { text: 'Hi' }],
      ['e', 'end'],
    ],
    edges: [
      ['s', 'default', 'm'],
      ['m', 'default', 'e'],
    ],
  })

test.group('checkGraph / draft', () => {
  test('a complete graph has no problems in either mode', ({ assert }) => {
    assert.deepEqual(checkGraph(catalog, linear(), 'draft'), [])
    assert.deepEqual(checkGraph(catalog, linear(), 'publish'), [])
  })

  test('a half-built graph saves as a draft but does not publish', ({ assert }) => {
    const draft = graph({
      nodes: [
        ['s', 'start'],
        ['m', 'message', { text: '' }],
      ],
    })

    assert.deepEqual(checkGraph(catalog, draft, 'draft'), [])
    assert.sameMembers(codes(checkGraph(catalog, draft, 'publish')), [
      'port_unconnected',
      'port_unconnected',
      'config_required',
      'unreachable',
      'no_way_to_end',
      'no_way_to_end',
    ])
  })

  test('reports duplicate node and edge ids', ({ assert }) => {
    const flow = linear()

    flow.nodes.push({ ...flow.nodes[1], data: { text: 'again' } })
    flow.edges.push({ ...flow.edges[0] })

    assert.deepEqual(checkGraph(catalog, flow, 'draft'), [
      { code: 'duplicate_node_id', severity: 'impediment', nodeId: 'm' },
      { code: 'duplicate_edge_id', severity: 'impediment', edgeId: 's-default-m' },
    ])
  })

  test('reports invalid and duplicate variables', ({ assert }) => {
    const flow = linear()

    flow.variables = [
      { name: 'name', type: 'text' },
      { name: 'name', type: 'number' },
      { name: 'Bad Name', type: 'text' },
    ]

    assert.deepEqual(codes(checkGraph(catalog, flow, 'draft')), [
      'duplicate_variable',
      'invalid_variable_name',
    ])
  })

  test('needs exactly one start', ({ assert }) => {
    const none = graph({ nodes: [['e', 'end']] })

    const two = graph({
      nodes: [
        ['s', 'start'],
        ['t', 'start'],
        ['e', 'end'],
      ],
      edges: [
        ['s', 'default', 'e'],
        ['t', 'default', 'e'],
      ],
    })

    assert.deepEqual(checkGraph(catalog, none, 'draft'), [
      { code: 'start_count', severity: 'impediment', detail: '0' },
    ])
    assert.deepEqual(codes(checkGraph(catalog, two, 'draft')), ['start_count'])
  })

  test('reports edges that dangle, enter the start or leave a terminal', ({ assert }) => {
    const flow = linear()

    flow.edges.push(
      { id: 'ghost', source: 'm', sourceHandle: 'default', target: 'nowhere' },
      { id: 'loop', source: 'm', sourceHandle: 'default', target: 's' },
      { id: 'after', source: 'e', sourceHandle: 'default', target: 'm' },
    )

    assert.deepEqual(checkGraph(catalog, flow, 'draft'), [
      { code: 'edge_dangling', severity: 'impediment', edgeId: 'ghost' },
      { code: 'edge_into_start', severity: 'impediment', edgeId: 'loop', nodeId: 's' },
      { code: 'edge_from_terminal', severity: 'impediment', edgeId: 'after', nodeId: 'e' },
    ])
  })

  test('reports an unknown port and a port used twice', ({ assert }) => {
    const flow = linear()

    flow.edges.push(
      { id: 'typo', source: 's', sourceHandle: 'nope', target: 'e' },
      { id: 'second', source: 's', sourceHandle: 'default', target: 'e' },
    )

    assert.deepEqual(checkGraph(catalog, flow, 'draft'), [
      { code: 'unknown_port', severity: 'impediment', edgeId: 'typo', nodeId: 's', detail: 'nope' },
      {
        code: 'port_taken',
        severity: 'impediment',
        edgeId: 'second',
        nodeId: 's',
        detail: 'default',
      },
    ])
  })

  test('a port that exists while a field is set only exists then', ({ assert }) => {
    const question = (data: { timeoutMinutes?: number }) =>
      graph({
        variables: [{ name: 'a', type: 'text' }],
        nodes: [
          ['s', 'start'],
          ['q', 'question', { text: 'Q?', variable: 'a', capture: 'text', retries: 0, ...data }],
          ['e', 'end'],
        ],
        edges: [
          ['s', 'default', 'q'],
          ['q', 'answered', 'e'],
        ],
      })

    const timed = question({ timeoutMinutes: 5 })
    const untimed = question({})

    untimed.edges.push({ id: 'late', source: 'q', sourceHandle: 'timeout', target: 'e' })

    assert.deepEqual(codes(checkGraph(catalog, untimed, 'draft')), ['unknown_port'])
    assert.deepEqual(checkGraph(catalog, timed, 'publish'), [
      { code: 'port_unconnected', severity: 'impediment', nodeId: 'q', detail: 'timeout' },
    ])
  })

  test('ports from config follow the options', ({ assert }) => {
    const flow = graph({
      nodes: [
        ['s', 'start'],
        [
          'menu',
          'menu',
          {
            options: [
              { id: 'sales', label: '1' },
              { id: 'help', label: '2' },
            ],
          },
        ],
        ['e', 'end'],
      ],
      edges: [
        ['s', 'default', 'menu'],
        ['menu', 'sales', 'e'],
        ['menu', 'billing', 'e'],
      ],
    })

    assert.deepEqual(codes(checkGraph(catalog, flow, 'draft')), ['unknown_port'])
    assert.deepEqual(codes(checkGraph(catalog, flow, 'publish')), [
      'unknown_port',
      'port_unconnected',
    ])
  })

  test('a graph over the limits reports only that', ({ assert }) => {
    const flow = linear()

    flow.nodes = Array.from({ length: 501 }, (_, index) => ({
      ...flow.nodes[1],
      id: `n${index}`,
    }))

    assert.deepEqual(codes(checkGraph(catalog, flow, 'draft')), ['too_large'])
  })
})

test.group('checkGraph / publish', () => {
  test('reports unknown node types and versions it cannot run', ({ assert }) => {
    const flow = linear()

    flow.nodes.push({
      id: 'x',
      type: 'teleport',
      typeVersion: 1,
      position: { x: 0, y: 0 },
      data: {},
    })
    flow.nodes[1].typeVersion = 2
    flow.nodes[2].typeVersion = 0

    assert.deepEqual(checkGraph(catalog, flow, 'draft'), [])
    assert.deepEqual(
      checkGraph(catalog, flow, 'publish').filter(({ code }) => code !== 'unreachable'),
      [
        { code: 'unsupported_type_version', severity: 'impediment', nodeId: 'm', detail: '2' },
        { code: 'unsupported_type_version', severity: 'impediment', nodeId: 'e', detail: '0' },
        { code: 'unknown_type', severity: 'impediment', nodeId: 'x', detail: 'teleport' },
      ],
    )
  })

  test('reports unconnected ports and unreachable nodes', ({ assert }) => {
    const flow = graph({
      variables: [{ name: 'a', type: 'text' }],
      nodes: [
        ['s', 'start'],
        ['c', 'condition', { variable: 'a', operator: 'is_set' }],
        ['e', 'end'],
        ['orphan', 'message', { text: 'never' }],
        ['tail', 'end'],
      ],
      edges: [
        ['s', 'default', 'c'],
        ['c', 'true', 'e'],
        ['orphan', 'default', 'tail'],
      ],
    })

    assert.deepEqual(checkGraph(catalog, flow, 'publish'), [
      { code: 'port_unconnected', severity: 'impediment', nodeId: 'c', detail: 'false' },
      { code: 'unreachable', severity: 'impediment', nodeId: 'orphan' },
      { code: 'unreachable', severity: 'impediment', nodeId: 'tail' },
    ])
  })

  test('a cycle with no way to end fails, a cycle with an exit passes', ({ assert }) => {
    const closed = graph({
      nodes: [
        ['s', 'start'],
        ['a', 'message', { text: 'a' }],
        ['b', 'message', { text: 'b' }],
      ],
      edges: [
        ['s', 'default', 'a'],
        ['a', 'default', 'b'],
        ['b', 'default', 'a'],
      ],
    })

    const open = graph({
      variables: [{ name: 'n', type: 'number' }],
      nodes: [
        ['s', 'start'],
        ['c', 'condition', { variable: 'n', operator: 'gt', value: '3' }],
        ['a', 'message', { text: 'again' }],
        ['e', 'end'],
      ],
      edges: [
        ['s', 'default', 'c'],
        ['c', 'false', 'a'],
        ['a', 'default', 'c'],
        ['c', 'true', 'e'],
      ],
    })

    assert.deepEqual(checkGraph(catalog, closed, 'publish'), [
      { code: 'no_way_to_end', severity: 'impediment', nodeId: 's' },
      { code: 'no_way_to_end', severity: 'impediment', nodeId: 'a' },
      { code: 'no_way_to_end', severity: 'impediment', nodeId: 'b' },
    ])
    assert.deepEqual(checkGraph(catalog, open, 'publish'), [])
  })

  test('reports required config fields left empty', ({ assert }) => {
    const flow = linear()

    flow.nodes[1].data = { text: '  ' }

    assert.deepEqual(checkGraph(catalog, flow, 'publish'), [
      { code: 'config_required', severity: 'impediment', nodeId: 'm', field: 'text' },
    ])
  })

  test('every variable a field binds must be declared, with a type it accepts', ({ assert }) => {
    const flow = graph({
      variables: [{ name: 'code', type: 'number' }],
      nodes: [
        ['s', 'start'],
        ['ask', 'ask_code', { variable: 'code' }],
        ['c', 'condition', { variable: 'ghost', operator: 'is_set' }],
        ['m', 'message', { text: 'Your {{ code }} and {{other}}' }],
        ['e', 'end'],
      ],
      edges: [
        ['s', 'default', 'ask'],
        ['ask', 'default', 'c'],
        ['c', 'true', 'm'],
        ['c', 'false', 'm'],
        ['m', 'default', 'e'],
      ],
    })

    assert.deepEqual(checkGraph(catalog, flow, 'publish'), [
      {
        code: 'variable_type_mismatch',
        severity: 'impediment',
        nodeId: 'ask',
        field: 'variable',
        detail: 'code',
      },
      {
        code: 'variable_undeclared',
        severity: 'impediment',
        nodeId: 'c',
        field: 'variable',
        detail: 'ghost',
      },
      {
        code: 'variable_undeclared',
        severity: 'impediment',
        nodeId: 'm',
        field: 'text',
        detail: 'other',
      },
    ])
  })

  test('warns when a template renders a variable some path never sets', async ({ assert }) => {
    const flow = graph({
      variables: [
        { name: 'vip', type: 'boolean' },
        { name: 'name', type: 'text' },
      ],
      nodes: [
        ['s', 'start'],
        ['c', 'condition', { variable: 'vip', operator: 'is_true' }],
        ['set', 'set_variable', { variable: 'name', value: 'Ana' }],
        ['m', 'message', { text: 'Hi {{name}}' }],
        ['e', 'end'],
      ],
      edges: [
        ['s', 'default', 'c'],
        ['c', 'true', 'set'],
        ['c', 'false', 'm'],
        ['set', 'default', 'm'],
        ['m', 'default', 'e'],
      ],
    })

    assert.deepEqual(checkGraph(catalog, flow, 'publish'), [
      { code: 'variable_maybe_unset', severity: 'warning', nodeId: 'm', detail: 'name' },
    ])
    assert.equal((await nodes.compile(flow)).kind, 'compiled')

    flow.edges = flow.edges.filter(({ id }) => id !== 'c-false-m')
    flow.edges.push({ id: 'skip', source: 'c', sourceHandle: 'false', target: 'set' })

    assert.deepEqual(checkGraph(catalog, flow, 'publish'), [])
  })

  test('the catalog as JSON checks a graph the same way, as the editor does', ({ assert }) => {
    const browser: Catalog = JSON.parse(JSON.stringify(catalog))
    const flow = linear()

    flow.nodes[1].data = {}
    flow.edges.push({ id: 'x', source: 'e', sourceHandle: 'default', target: 'm' })

    assert.deepEqual(browser, catalog)
    assert.deepEqual(checkGraph(browser, flow, 'publish'), checkGraph(catalog, flow, 'publish'))
  })

  test('the ./graph entry imports no runtime code beyond its own folder', async ({ assert }) => {
    const folder = new URL('../src/graph/', import.meta.url)

    for (const file of await readdir(folder)) {
      const source = await readFile(new URL(file, folder), 'utf8')

      const runtime = [...source.matchAll(/^import (?!type )[^'"]*from '([^']+)'/gm)].map(
        match => match[1],
      )

      assert.isTrue(
        runtime.every(specifier => specifier.startsWith('./')),
        `${file} imports ${runtime.join(', ')}`,
      )
    }
  })
})

test.group('registry.check', () => {
  test('publish adds config validity and node rules, which need the definitions', async ({
    assert,
  }) => {
    const flow = graph({
      variables: [
        { name: 'name', type: 'text' },
        { name: 'age', type: 'text' },
      ],
      nodes: [
        ['s', 'start'],
        ['c', 'condition', { variable: 'name', operator: 'gt', value: '3' }],
        ['q', 'question', { text: 'Age?', variable: 'age', capture: 'number', retries: 9 }],
        ['h', 'handoff', { target: 'queue' }],
        ['e', 'end'],
      ],
      edges: [
        ['s', 'default', 'c'],
        ['c', 'true', 'q'],
        ['c', 'false', 'h'],
        ['q', 'answered', 'e'],
      ],
    })

    assert.deepEqual(await nodes.check(flow, 'draft'), [])

    const problems = await nodes.check(flow, 'publish')

    assert.deepEqual(
      problems.map(({ code, nodeId, field }) => ({ code, nodeId, field })),
      [
        { code: 'node_rule', nodeId: 'c', field: 'operator' },
        { code: 'config_invalid', nodeId: 'q', field: 'retries' },
        { code: 'node_rule', nodeId: 'h', field: 'queueId' },
      ],
    )
    assert.deepEqual(await nodes.compile(flow), { kind: 'invalid', problems })
  })

  test('a question capture must match the type of its variable', async ({ assert }) => {
    const flow = graph({
      variables: [{ name: 'age', type: 'text' }],
      nodes: [
        ['s', 'start'],
        ['q', 'question', { text: 'Age?', variable: 'age', capture: 'number', retries: 0 }],
        ['e', 'end'],
      ],
      edges: [
        ['s', 'default', 'q'],
        ['q', 'answered', 'e'],
      ],
    })

    assert.containsSubset(await registry.check(flow, 'publish'), [
      { code: 'node_rule', nodeId: 'q', field: 'variable' },
    ])

    flow.variables = [{ name: 'age', type: 'number' }]

    assert.deepEqual(await registry.check(flow, 'publish'), [])
  })

  test('duplicate node types and a missing start fail at boot', ({ assert }) => {
    assert.throws(() => defineNodes([...builtins, menu, menu]), 'node type "menu" is defined twice')
    assert.throws(() => defineNodes([menu]), 'a node registry needs the "start" node')
  })
})

test.group('graphHash', () => {
  test('ignores positions, edge ids and the order of nodes, edges and keys', ({ assert }) => {
    const flow = linear()

    const moved: FlowGraph = {
      ...flow,
      nodes: [...flow.nodes]
        .reverse()
        .map(node => ({ ...node, position: { x: node.position.x + 50, y: 300 } })),
      edges: [...flow.edges].reverse().map((edge, index) => ({ ...edge, id: `e${index}` })),
    }

    assert.equal(graphHash(moved), graphHash(flow))
  })

  test('changes with anything a run reads', ({ assert }) => {
    const flow = linear()
    const base = graphHash(flow)
    const text = structuredClone(flow)
    const rewired = structuredClone(flow)
    const typed = structuredClone(flow)

    text.nodes[1].data = { text: 'Hello' }
    rewired.edges[1].target = 's'
    typed.variables = [{ name: 'a', type: 'text' }]

    assert.notEqual(graphHash(text), base)
    assert.notEqual(graphHash(rewired), base)
    assert.notEqual(graphHash(typed), base)
    assert.match(base, /^[0-9a-f]{64}$/)
  })
})
