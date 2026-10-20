import { test } from '@japa/runner'
import vine from '@vinejs/vine'

import {
  builtins,
  defineEffect,
  defineNode,
  defineNodes,
  runTurn,
  type JsonObject,
  type Outcome,
} from '../index.ts'
import { Conversation, Discard, compiled, graph, inbound, said, t0 } from './helpers.ts'

const askEmail = defineNode({
  type: 'ask_email',
  typeVersion: 1,
  config: vine.object({ prompt: vine.string(), variable: vine.string(), retry: vine.string() }),
  defaults: { prompt: 'Email?', variable: 'email', retry: 'Not an email.' },
  fields: {
    prompt: { label: 'Question', binds: 'template' },
    variable: { label: 'Save as', binds: { writes: ['text'] } },
    retry: { label: 'When invalid', binds: 'template' },
  },
  ports: [{ id: 'valid' }, { id: 'invalid' }],
  ui: { label: 'Ask for email', category: 'Capture' },
  enter: ({ config }) => ({ say: [config.prompt], wait: { for: 'message' } }),
  resume: ({ config }, input) => {
    if (input.kind === 'elapsed') return { go: 'invalid' }

    const email = input.text.trim().toLowerCase()

    return email.includes('@')
      ? { go: 'valid', set: { variable: { type: 'text', value: email } } }
      : { go: 'invalid', say: [config.retry] }
  },
})

const addTag = defineNode({
  type: 'add_tag',
  typeVersion: 1,
  config: vine.object({ tag: vine.string().minLength(1) }),
  defaults: { tag: '' },
  ports: [{ id: 'default' }],
  effect: defineEffect({
    payload: vine.object({ tag: vine.string() }),
    delivery: 'in_transaction',
    handler: async () => ({ default: Discard }),
  }),
  ui: { label: 'Add tag', category: 'Actions' },
  execute: ({ config }) => ({ go: 'default', effect: { tag: config.tag } }),
})

const explode = defineNode({
  type: 'explode',
  typeVersion: 1,
  config: vine.object({}),
  defaults: {},
  ports: [{ id: 'default' }],
  ui: { label: 'Explode', category: 'Test' },
  execute: () => {
    throw new Error('the CRM is down')
  },
})

/**
 * Writes a number into a variable a graph may declare as text, which the run must refuse.
 */
const countInto = defineNode({
  type: 'count_into',
  typeVersion: 1,
  config: vine.object({ variable: vine.string() }),
  defaults: { variable: '' },
  fields: { variable: { label: 'Into', binds: { writes: ['text', 'number'] } } },
  ports: [{ id: 'default' }],
  ui: { label: 'Count', category: 'Test' },
  execute: () => ({ go: 'default', set: { variable: { type: 'number', value: 3 } } }),
})

const nodes = defineNodes([...builtins, askEmail, addTag, explode, countInto])

function ended(outcome: Outcome) {
  if (outcome.kind !== 'end') throw new Error(`expected the run to end, got ${outcome.kind}`)

  return outcome
}

function waiting(outcome: Outcome) {
  if (outcome.kind !== 'wait') throw new Error(`expected the run to wait, got ${outcome.kind}`)

  return outcome
}

test.group('runTurn / built-in nodes', () => {
  test('start, message and end say the text and return the ticket', async ({ assert }) => {
    const flow = graph({
      nodes: [
        ['s', 'start'],
        ['m', 'message', { text: 'Hello' }],
        ['e', 'end'],
      ],
      edges: [
        ['s', 'default', 'm'],
        ['m', 'default', 'e'],
      ],
    })

    const outcome = ended(new Conversation(await compiled(flow)).turn({ kind: 'assigned' }))

    assert.deepEqual(said(outcome), ['Hello'])
    assert.equal(outcome.reason, 'completed')
    assert.deepEqual(outcome.handoff, { gesture: 'return' })
    assert.equal(outcome.state.status, 'ended')
  })

  test('a message renders the variables set before it', async ({ assert }) => {
    const flow = graph({
      variables: [
        { name: 'name', type: 'text' },
        { name: 'age', type: 'number' },
      ],
      nodes: [
        ['s', 'start'],
        ['n', 'set_variable', { variable: 'name', value: 'Ana' }],
        ['a', 'set_variable', { variable: 'age', value: ' 42 ' }],
        ['m', 'message', { text: '{{name}} is {{ age }}, {{name}}' }],
        ['e', 'end'],
      ],
      edges: [
        ['s', 'default', 'n'],
        ['n', 'default', 'a'],
        ['a', 'default', 'm'],
        ['m', 'default', 'e'],
      ],
    })

    const outcome = ended(new Conversation(await compiled(flow)).turn({ kind: 'assigned' }))

    assert.deepEqual(said(outcome), ['Ana is 42, Ana'])
    assert.deepEqual(outcome.state.vars, {
      name: { type: 'text', value: 'Ana' },
      age: { type: 'number', value: 42 },
    })
  })

  test('set_variable leaves a variable unset when the value is not of its type', async ({
    assert,
  }) => {
    const flow = graph({
      variables: [{ name: 'age', type: 'number' }],
      nodes: [
        ['s', 'start'],
        ['a', 'set_variable', { variable: 'age', value: 'forty' }],
        ['e', 'end'],
      ],
      edges: [
        ['s', 'default', 'a'],
        ['a', 'default', 'e'],
      ],
    })

    const outcome = ended(new Conversation(await compiled(flow)).turn({ kind: 'assigned' }))

    assert.deepEqual(outcome.state.vars, {})
  })

  test('a handoff to its own queue returns the ticket after saying its text', async ({
    assert,
  }) => {
    const flow = graph({
      nodes: [
        ['s', 'start'],
        ['h', 'handoff', { target: 'own_queue', text: 'One moment' }],
      ],
      edges: [['s', 'default', 'h']],
    })

    const outcome = ended(new Conversation(await compiled(flow)).turn({ kind: 'assigned' }))

    assert.deepEqual(said(outcome), ['One moment'])
    assert.equal(outcome.reason, 'handed_off')
    assert.deepEqual(outcome.handoff, { gesture: 'return' })
  })

  test('a handoff to a queue transfers the ticket, to an attendant when set', async ({
    assert,
  }) => {
    const flow = graph({
      nodes: [
        ['s', 'start'],
        ['h', 'handoff', { target: 'queue', queueId: 7, attendantId: 3 }],
      ],
      edges: [['s', 'default', 'h']],
    })

    const outcome = ended(new Conversation(await compiled(flow)).turn({ kind: 'assigned' }))

    assert.equal(outcome.reason, 'handed_off')
    assert.deepEqual(outcome.handoff, { gesture: 'transfer', queueId: 7, to: 3 })
    assert.deepEqual(said(outcome), [])
  })

  test('close closes the ticket with its reason', async ({ assert }) => {
    const flow = graph({
      nodes: [
        ['s', 'start'],
        ['c', 'close', { reason: 'bot_completed', text: 'Bye' }],
      ],
      edges: [['s', 'default', 'c']],
    })

    const outcome = ended(new Conversation(await compiled(flow)).turn({ kind: 'assigned' }))

    assert.deepEqual(said(outcome), ['Bye'])
    assert.equal(outcome.reason, 'closed')
    assert.deepEqual(outcome.handoff, { gesture: 'close', reason: 'bot_completed' })
  })

  test('a contact message starts a fresh run too', async ({ assert }) => {
    const flow = graph({
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

    const outcome = new Conversation(await compiled(flow)).write('hello')

    assert.deepEqual(said(outcome), ['Hi'])
  })
})

const delayed = graph({
  variables: [{ name: 'age', type: 'number' }],
  nodes: [
    ['s', 'start'],
    ['d', 'delay', { seconds: 30 }],
    ['q', 'question', { text: 'Age?', variable: 'age', capture: 'number', retries: 0 }],
    ['m', 'message', { text: 'You are {{age}}' }],
    ['e', 'end'],
  ],
  edges: [
    ['s', 'default', 'd'],
    ['d', 'default', 'q'],
    ['q', 'answered', 'm'],
    ['m', 'default', 'e'],
  ],
})

test.group('runTurn / delay', () => {
  test('waits until its time and ignores messages meanwhile', async ({ assert }) => {
    const run = new Conversation(await compiled(delayed))
    const first = waiting(run.write('hi'))

    assert.deepEqual(said(first), [])
    assert.equal(first.state.waiting.for, 'time')
    assert.deepEqual(first.wake, { at: t0.plus({ seconds: 30 }), token: first.state.waiting.token })

    assert.deepEqual(run.write('31'), { kind: 'idle', reason: 'waiting_for_time' })

    run.now = t0.plus({ seconds: 30 })
    const asked = waiting(run.turn({ kind: 'wake', token: first.state.waiting.token }))

    assert.deepEqual(said(asked), ['Age?'])
    assert.deepEqual(run.write('40').kind, 'end')
    assert.deepEqual(run.state.vars, { age: { type: 'number', value: 40 } })
  })

  test('a message sent during a delay never answers the question after it', async ({ assert }) => {
    const flow = await compiled(delayed)
    const hi = inbound(1, 'hi')
    const early = inbound(2, '31')

    const first = waiting(
      runTurn(
        flow,
        { status: 'fresh', vars: {} },
        {
          trigger: { kind: 'message' },
          unanswered: [hi],
          now: t0,
        },
      ),
    )

    const asked = waiting(
      runTurn(flow, first.state, {
        trigger: { kind: 'wake', token: first.state.waiting.token },
        unanswered: [hi, early],
        now: t0.plus({ minutes: 1 }),
      }),
    )

    assert.deepEqual(said(asked), ['Age?'])
    assert.deepEqual(
      runTurn(flow, asked.state, {
        trigger: { kind: 'message' },
        unanswered: [hi, early],
        now: t0.plus({ minutes: 2 }),
      }),
      { kind: 'idle', reason: 'no_answer' },
    )

    const answered = ended(
      runTurn(flow, asked.state, {
        trigger: { kind: 'message' },
        unanswered: [hi, early, inbound(3, '40')],
        now: t0.plus({ minutes: 2 }),
      }),
    )

    assert.deepEqual(said(answered), ['You are 40'])
  })

  test('a wake before its time, or with another token, does nothing', async ({ assert }) => {
    const run = new Conversation(await compiled(delayed))
    const first = waiting(run.turn({ kind: 'assigned' }))

    assert.deepEqual(run.turn({ kind: 'wake', token: first.state.waiting.token }), {
      kind: 'idle',
      reason: 'not_due',
    })

    run.now = t0.plus({ hours: 1 })

    assert.deepEqual(run.turn({ kind: 'wake', token: 'd:99' }), {
      kind: 'idle',
      reason: 'stale_wake',
    })
    assert.deepEqual(run.state, first.state)
  })
})

const CAPTURED = {
  text: 'text',
  email: 'text',
  phone: 'text',
  number: 'number',
  boolean: 'boolean',
} as const

function questionFlow(question: JsonObject & { capture: keyof typeof CAPTURED }) {
  return graph({
    variables: [{ name: 'answer', type: CAPTURED[question.capture] }],
    nodes: [
      ['s', 'start'],
      ['q', 'question', { text: 'Q?', variable: 'answer', retries: 0, ...question }],
      ['set', 'condition', { variable: 'answer', operator: 'is_set' }],
      ['yes', 'message', { text: 'got {{answer}}' }],
      ['no', 'message', { text: 'no answer' }],
      ...(question.timeoutMinutes ? [['late', 'message', { text: 'too late' }] as const] : []),
      ['e', 'end'],
    ],
    edges: [
      ['s', 'default', 'q'],
      ['q', 'answered', 'set'],
      ...(question.timeoutMinutes ? [['q', 'timeout', 'late'] as const] : []),
      ['set', 'true', 'yes'],
      ['set', 'false', 'no'],
      ['yes', 'default', 'e'],
      ['no', 'default', 'e'],
      ...(question.timeoutMinutes ? [['late', 'default', 'e'] as const] : []),
    ],
  })
}

test.group('runTurn / question', () => {
  test('asks, waits, and stores the answer as its capture', async ({ assert }) => {
    const run = new Conversation(await compiled(questionFlow({ capture: 'number' })))
    const asked = waiting(run.turn({ kind: 'assigned' }))

    assert.deepEqual(said(asked), ['Q?'])
    assert.isNull(asked.wake)
    assert.deepEqual(said(run.write(' 12 ')), ['got 12'])
    assert.deepEqual(run.state.vars, { answer: { type: 'number', value: 12 } })
  })

  test('reads email and phone captures into text', async ({ assert }) => {
    const email = new Conversation(await compiled(questionFlow({ capture: 'email' })))

    email.turn({ kind: 'assigned' })
    assert.deepEqual(said(email.write(' Ana@X.io ')), ['got ana@x.io'])

    const phone = new Conversation(await compiled(questionFlow({ capture: 'phone' })))

    phone.turn({ kind: 'assigned' })
    assert.deepEqual(said(phone.write('+55 (11) 98765-4321')), ['got +5511987654321'])
  })

  test('joins a batch of answers by newline', async ({ assert }) => {
    const run = new Conversation(await compiled(questionFlow({ capture: 'text' })))

    run.turn({ kind: 'assigned' })
    run.unanswered = [inbound(1, 'first'), inbound(2, 'second')]

    assert.deepEqual(said(run.turn({ kind: 'message' })), ['got first\nsecond'])
  })

  test('re-asks an unreadable answer, then leaves with the variable unset', async ({ assert }) => {
    const run = new Conversation(
      await compiled(questionFlow({ capture: 'number', retries: 2, retryText: 'A number?' })),
    )

    run.turn({ kind: 'assigned' })

    const again = waiting(run.write('ten'))

    assert.deepEqual(said(again), ['A number?'])
    assert.containsSubset(again.state.waiting, { node: 'q', attempt: 1 })
    assert.containsSubset(waiting(run.write('eleven')).state.waiting, { attempt: 2 })
    assert.deepEqual(said(run.write('twelve')), ['no answer'])
    assert.deepEqual(run.state.vars, {})
  })

  test('re-asks with the question when no retry text is set', async ({ assert }) => {
    const run = new Conversation(await compiled(questionFlow({ capture: 'boolean', retries: 1 })))

    run.turn({ kind: 'assigned' })

    assert.deepEqual(said(run.write('maybe')), ['Q?'])
    assert.deepEqual(said(run.write('yes')), ['got true'])
  })

  test('takes the timeout port when no answer came in time', async ({ assert }) => {
    const run = new Conversation(
      await compiled(questionFlow({ capture: 'text', timeoutMinutes: 5 })),
    )

    const asked = waiting(run.turn({ kind: 'assigned' }))
    const token = asked.state.waiting.token

    assert.deepEqual(asked.wake, { at: t0.plus({ minutes: 5 }), token })
    assert.deepEqual(run.turn({ kind: 'wake', token }), { kind: 'idle', reason: 'not_due' })

    run.now = t0.plus({ minutes: 5 })

    assert.deepEqual(said(run.turn({ kind: 'wake', token })), ['too late'])
  })

  test('a timeout wake that finds an answer takes the answer', async ({ assert }) => {
    const run = new Conversation(
      await compiled(questionFlow({ capture: 'text', timeoutMinutes: 5 })),
    )

    const asked = waiting(run.turn({ kind: 'assigned' }))

    run.now = t0.plus({ minutes: 6 })
    run.unanswered = [inbound(1, 'here')]

    assert.deepEqual(said(run.turn({ kind: 'wake', token: asked.state.waiting.token })), [
      'got here',
    ])
  })

  test('the message that started the run never answers its first question', async ({ assert }) => {
    const flow = await compiled(questionFlow({ capture: 'text' }))
    const hi = inbound(1, 'hi')

    const asked = waiting(
      runTurn(
        flow,
        { status: 'fresh', vars: {} },
        {
          trigger: { kind: 'message' },
          unanswered: [hi],
          now: t0,
        },
      ),
    )

    assert.equal(asked.state.seen, hi.id)
    assert.deepEqual(
      runTurn(flow, asked.state, { trigger: { kind: 'message' }, unanswered: [hi], now: t0 }),
      { kind: 'idle', reason: 'no_answer' },
    )
  })

  test('each wait gets its own token, so an old one never wakes a later wait', async ({
    assert,
  }) => {
    const run = new Conversation(
      await compiled(questionFlow({ capture: 'number', retries: 1, timeoutMinutes: 5 })),
    )

    const first = waiting(run.turn({ kind: 'assigned' }))
    const second = waiting(run.write('ten'))

    assert.notEqual(first.state.waiting.token, second.state.waiting.token)

    run.now = t0.plus({ minutes: 10 })

    assert.deepEqual(run.turn({ kind: 'wake', token: first.state.waiting.token }), {
      kind: 'idle',
      reason: 'stale_wake',
    })
  })
})

test.group('runTurn / lifecycle', () => {
  test('an ended run, a wake before the start and a second assignment do nothing', async ({
    assert,
  }) => {
    const flow = await compiled(questionFlow({ capture: 'text' }))
    const input = { unanswered: [], now: t0 }

    assert.deepEqual(
      runTurn(
        flow,
        { status: 'ended', vars: {}, reason: 'completed' },
        {
          ...input,
          trigger: { kind: 'message' },
        },
      ),
      { kind: 'idle', reason: 'ended' },
    )
    assert.deepEqual(
      runTurn(
        flow,
        { status: 'fresh', vars: {} },
        {
          ...input,
          trigger: { kind: 'wake', token: 'x' },
        },
      ),
      { kind: 'idle', reason: 'not_started' },
    )

    const asked = waiting(
      runTurn(flow, { status: 'fresh', vars: {} }, { ...input, trigger: { kind: 'assigned' } }),
    )

    assert.deepEqual(runTurn(flow, asked.state, { ...input, trigger: { kind: 'assigned' } }), {
      kind: 'idle',
      reason: 'already_running',
    })
  })

  test('a cycle ends at the step budget and returns the ticket', async ({ assert }) => {
    const flow = graph({
      variables: [{ name: 'n', type: 'number' }],
      nodes: [
        ['s', 'start'],
        ['set', 'set_variable', { variable: 'n', value: '1' }],
        ['check', 'condition', { variable: 'n', operator: 'equals', value: '2' }],
        ['again', 'message', { text: 'again' }],
        ['e', 'end'],
      ],
      edges: [
        ['s', 'default', 'set'],
        ['set', 'default', 'check'],
        ['check', 'true', 'e'],
        ['check', 'false', 'again'],
        ['again', 'default', 'check'],
      ],
    })

    const budget = ended(new Conversation(await compiled(flow), 9).turn({ kind: 'assigned' }))

    assert.equal(budget.reason, 'step_budget_exhausted')
    assert.deepEqual(budget.handoff, { gesture: 'return' })
    assert.deepEqual(said(budget), ['again', 'again', 'again'])

    const byDefault = ended(new Conversation(await compiled(flow)).turn({ kind: 'assigned' }))

    assert.equal(byDefault.reason, 'step_budget_exhausted')
    assert.lengthOf(said(byDefault), 24)
  })
})

test.group('runTurn / custom nodes', () => {
  const emailFlow = graph({
    variables: [{ name: 'email', type: 'text' }],
    nodes: [
      ['s', 'start'],
      ['ask', 'ask_email', { prompt: 'Email?', variable: 'email', retry: 'Not an email.' }],
      ['tag', 'add_tag', { tag: 'lead' }],
      ['thanks', 'message', { text: 'Thanks, {{email}}' }],
      ['e', 'end'],
      ['h', 'handoff', { target: 'own_queue' }],
    ],
    edges: [
      ['s', 'default', 'ask'],
      ['ask', 'valid', 'tag'],
      ['ask', 'invalid', 'h'],
      ['tag', 'default', 'thanks'],
      ['thanks', 'default', 'e'],
    ],
  })

  test('ask_email takes valid, emits its tag effect, and renders the email', async ({ assert }) => {
    const run = new Conversation(await compiled(emailFlow, nodes))

    assert.deepEqual(said(run.turn({ kind: 'assigned' })), ['Email?'])

    const done = ended(run.write(' Ana@X.io '))

    assert.deepEqual(said(done), ['Thanks, ana@x.io'])
    assert.deepEqual(done.effects, [
      { node: 'tag', type: 'add_tag', delivery: 'in_transaction', payload: { tag: 'lead' } },
    ])
    assert.equal(done.reason, 'completed')
  })

  test('ask_email takes invalid and hands off', async ({ assert }) => {
    const run = new Conversation(await compiled(emailFlow, nodes))

    run.turn({ kind: 'assigned' })

    const done = ended(run.write('no idea'))

    assert.deepEqual(said(done), ['Not an email.'])
    assert.equal(done.reason, 'handed_off')
    assert.deepEqual(done.effects, [])
  })

  test('a node that throws ends the run failed and hands the ticket back', async ({ assert }) => {
    const flow = graph({
      nodes: [
        ['s', 'start'],
        ['m', 'message', { text: 'Checking' }],
        ['x', 'explode'],
        ['e', 'end'],
      ],
      edges: [
        ['s', 'default', 'm'],
        ['m', 'default', 'x'],
        ['x', 'default', 'e'],
      ],
    })

    const outcome = ended(new Conversation(await compiled(flow, nodes)).turn({ kind: 'assigned' }))

    assert.equal(outcome.reason, 'failed')
    assert.deepEqual(outcome.handoff, { gesture: 'return' })
    assert.include(outcome.detail ?? '', 'the CRM is down')
    assert.deepEqual(said(outcome), ['Checking'])
  })

  test('a node setting a value of another type ends the run failed', async ({ assert }) => {
    const flow = graph({
      variables: [{ name: 'label', type: 'text' }],
      nodes: [
        ['s', 'start'],
        ['c', 'count_into', { variable: 'label' }],
        ['e', 'end'],
      ],
      edges: [
        ['s', 'default', 'c'],
        ['c', 'default', 'e'],
      ],
    })

    const outcome = ended(new Conversation(await compiled(flow, nodes)).turn({ kind: 'assigned' }))

    assert.equal(outcome.reason, 'failed')
    assert.deepEqual(outcome.state.vars, {})
  })
})
