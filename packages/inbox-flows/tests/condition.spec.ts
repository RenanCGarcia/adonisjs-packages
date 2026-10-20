import { test } from '@japa/runner'

import { compare, operatorsFor, type VariableType } from '../index.ts'
import { Conversation, compiled, graph, said } from './helpers.ts'

interface Row {
  type: VariableType
  /**
   * `null` leaves the variable unset.
   */
  left: string | null
  operator: string
  value?: string
  holds: boolean
}

const rows: Row[] = [
  { type: 'text', left: ' Hello World ', operator: 'equals', value: 'hello world', holds: true },
  { type: 'text', left: 'Hello', operator: 'equals', value: 'bye', holds: false },
  { type: 'text', left: 'Hello', operator: 'not_equals', value: 'bye', holds: true },
  { type: 'text', left: 'Hello', operator: 'not_equals', value: 'HELLO', holds: false },
  { type: 'text', left: 'I want the PRICE', operator: 'contains', value: 'price', holds: true },
  { type: 'text', left: 'Hello', operator: 'contains', value: 'bye', holds: false },
  { type: 'text', left: 'Hello', operator: 'not_contains', value: 'bye', holds: true },
  { type: 'text', left: 'Hello', operator: 'not_contains', value: 'ell', holds: false },
  { type: 'text', left: 'Hello', operator: 'starts_with', value: 'he', holds: true },
  { type: 'text', left: 'Hello', operator: 'starts_with', value: 'lo', holds: false },
  { type: 'text', left: '{{blank}}', operator: 'is_empty', holds: true },
  { type: 'text', left: 'x', operator: 'is_empty', holds: false },
  { type: 'text', left: 'x', operator: 'is_set', holds: true },
  { type: 'text', left: null, operator: 'is_set', holds: false },
  { type: 'text', left: null, operator: 'is_not_set', holds: true },
  { type: 'text', left: null, operator: 'equals', value: '', holds: false },
  { type: 'number', left: '10', operator: 'equals', value: '10.0', holds: true },
  { type: 'number', left: '10', operator: 'not_equals', value: '11', holds: true },
  { type: 'number', left: '10', operator: 'gt', value: '9', holds: true },
  { type: 'number', left: '10', operator: 'gt', value: '10', holds: false },
  { type: 'number', left: '10', operator: 'gte', value: '10', holds: true },
  { type: 'number', left: '9', operator: 'lt', value: '10', holds: true },
  { type: 'number', left: '10', operator: 'lt', value: '10', holds: false },
  { type: 'number', left: '10', operator: 'lte', value: '10', holds: true },
  { type: 'number', left: '2', operator: 'gt', value: '10', holds: false },
  { type: 'number', left: null, operator: 'lt', value: '10', holds: false },
  { type: 'number', left: '3', operator: 'is_not_set', holds: false },
  { type: 'boolean', left: 'yes', operator: 'is_true', holds: true },
  { type: 'boolean', left: 'no', operator: 'is_true', holds: false },
  { type: 'boolean', left: 'false', operator: 'is_false', holds: true },
  { type: 'boolean', left: null, operator: 'is_false', holds: false },
  { type: 'boolean', left: 'true', operator: 'is_set', holds: true },
]

test.group('condition node', () => {
  test('{title}')
    .with(
      rows.map(row => ({ ...row, title: `${row.type} ${row.left} ${row.operator} ${row.value}` })),
    )
    .run(async ({ assert }, row) => {
      const assigns =
        row.left === null
          ? []
          : [['set', 'set_variable', { variable: 'x', value: row.left }] as const]

      const flow = graph({
        variables: [
          { name: 'x', type: row.type },
          { name: 'blank', type: 'text' },
        ],
        nodes: [
          ['s', 'start'],
          ...assigns,
          ['c', 'condition', { variable: 'x', operator: row.operator, value: row.value ?? '' }],
          ['yes', 'message', { text: 'yes' }],
          ['no', 'message', { text: 'no' }],
          ['e', 'end'],
        ],
        edges: [
          ...(row.left === null
            ? [['s', 'default', 'c'] as const]
            : [['s', 'default', 'set'] as const, ['set', 'default', 'c'] as const]),
          ['c', 'true', 'yes'],
          ['c', 'false', 'no'],
          ['yes', 'default', 'e'],
          ['no', 'default', 'e'],
        ],
      })

      const outcome = new Conversation(await compiled(flow)).turn({ kind: 'assigned' })

      assert.deepEqual(said(outcome), [row.holds ? 'yes' : 'no'])
    })

  test('an operator the type does not offer is false, never an error', ({ assert }) => {
    assert.isFalse(compare({ type: 'text', value: 'abc' }, 'gt', 'a'))
    assert.isFalse(compare({ type: 'number', value: 3 }, 'contains', '3'))
    assert.isFalse(compare({ type: 'number', value: 3 }, 'gt', 'three'))
  })

  test('each type offers its own operators, with whether they take a value', ({ assert }) => {
    assert.includeDeepMembers(operatorsFor('text'), [
      { id: 'contains', operand: true },
      { id: 'is_empty', operand: false },
      { id: 'is_set', operand: false },
    ])
    assert.notDeepInclude(operatorsFor('text'), { id: 'gt', operand: true })
    assert.deepInclude(operatorsFor('number'), { id: 'gte', operand: true })
    assert.sameDeepMembers(operatorsFor('boolean'), [
      { id: 'is_true', operand: false },
      { id: 'is_false', operand: false },
      { id: 'is_set', operand: false },
      { id: 'is_not_set', operand: false },
    ])
  })
})
