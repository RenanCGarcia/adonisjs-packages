import type {
  BotHandoff,
  InboundMessage,
  JsonValue,
  MessageContent,
  MessageId,
} from '@enzopita/adonisjs-inbox'
import type { DateTime } from 'luxon'

import type { BoundNode, BoundStep, CompiledGraph, Ending, ResumeInput } from './define.ts'
import type { EffectDelivery } from './graph/types.ts'
import type { Value, Variables } from './graph/values.ts'

/**
 * Where a live run rests between turns. `token` names this one wait: a wake carrying another
 * token is late or duplicated and does nothing.
 */
export type Waiting =
  | {
      for: 'message'
      node: string
      token: string
      timeoutAt: DateTime | null
      /**
       * Times the node waited again from its own `resume`, such as a question re-asking.
       */
      attempt: number
    }
  | { for: 'time'; node: string; token: string; until: DateTime }

export type EndReason = 'completed' | 'handed_off' | 'closed' | 'step_budget_exhausted' | 'failed'

/**
 * A run between turns. Plain data; the caller stores it and hands it back on the next turn.
 */
export type RunState =
  | { status: 'fresh'; vars: Variables }
  | {
      status: 'waiting'
      vars: Variables
      waiting: Waiting
      /**
       * The newest inbound message when the wait began. Only later messages answer it, so the
       * message that opened the ticket, or one sent during a delay, never answers a question.
       */
      seen: MessageId | null
      /**
       * Waits begun so far, which makes every wait's token unique within the run.
       */
      waits: number
    }
  | { status: 'ended'; vars: Variables; reason: EndReason }

export type Trigger = { kind: 'assigned' } | { kind: 'message' } | { kind: 'wake'; token: string }

export interface TurnInput {
  trigger: Trigger
  /**
   * The inbox's `BotTurn.unanswered`: inbound messages since the last reply, oldest first.
   */
  unanswered: InboundMessage[]
  now: DateTime
}

export interface EmittedEffect {
  node: string
  type: string
  delivery: EffectDelivery
  payload: JsonValue
}

export type IdleReason =
  | 'ended'
  | 'not_started'
  | 'already_running'
  | 'no_answer'
  | 'waiting_for_time'
  | 'stale_wake'
  | 'not_due'

/**
 * What one turn does. `idle` changes nothing, so the caller commits nothing. A turn that ends
 * always carries the handoff that gives the ticket back.
 */
export type Outcome =
  | { kind: 'idle'; reason: IdleReason }
  | {
      kind: 'wait'
      say: MessageContent[]
      effects: EmittedEffect[]
      state: Extract<RunState, { status: 'waiting' }>
      /**
       * When to wake the run with `state.waiting.token`. `null` for a message wait without a
       * timeout.
       */
      wake: { at: DateTime; token: string } | null
    }
  | {
      kind: 'end'
      say: MessageContent[]
      effects: EmittedEffect[]
      state: Extract<RunState, { status: 'ended' }>
      reason: EndReason
      handoff: BotHandoff
      detail: string | null
    }

export const DEFAULT_MAX_STEPS = 50

function newest(seen: MessageId | null, messages: InboundMessage[]) {
  let latest = seen

  for (const message of messages) {
    if (latest === null || message.id > latest) latest = message.id
  }

  return latest
}

interface Handback {
  reason: EndReason
  handoff: BotHandoff
}

function handoffOf(ending: Ending): Handback {
  switch (ending.end) {
    case 'complete':
      return { reason: 'completed', handoff: { gesture: 'return' } }
    case 'close':
      return { reason: 'closed', handoff: { gesture: 'close', reason: ending.reason } }
    case 'handoff':
      return {
        reason: 'handed_off',
        handoff:
          ending.to === 'own_queue'
            ? { gesture: 'return' }
            : { gesture: 'transfer', queueId: ending.to.queueId, to: ending.to.attendantId },
      }
  }
}

/**
 * Starts the run on `start`, or resumes the node it waits on, then follows ports until a node
 * waits or the run ends. Pure: no IO, no clock but `input.now`.
 *
 * - At most `maxSteps` nodes run per turn, so a graph that loops ends `step_budget_exhausted`.
 * - A node that throws, sets a variable to another type, or leaves through a port it doesn't
 *   have ends the run `failed`. A broken node is an outcome, never a crash, so a deterministic
 *   failure can't burn the inbox's turn retries.
 * - Everything said and emitted before the run ended stays: the caller commits it at most once.
 */
export function runTurn(
  graph: CompiledGraph,
  state: RunState,
  input: TurnInput,
  maxSteps = DEFAULT_MAX_STEPS,
): Outcome {
  if (state.status === 'ended') return { kind: 'idle', reason: 'ended' }

  if (state.status === 'fresh') {
    if (input.trigger.kind === 'wake') return { kind: 'idle', reason: 'not_started' }

    return advance(graph, { vars: state.vars, seen: null, waits: 0 }, input, maxSteps, null)
  }

  const { waiting, seen } = state
  const answers = input.unanswered.filter(message => seen === null || message.id > seen)
  const trigger = input.trigger

  if (trigger.kind === 'assigned') return { kind: 'idle', reason: 'already_running' }

  if (trigger.kind === 'wake' && trigger.token !== waiting.token) {
    return { kind: 'idle', reason: 'stale_wake' }
  }

  const due = (at: DateTime | null) => at !== null && at <= input.now

  if (waiting.for === 'time') {
    if (trigger.kind === 'message') return { kind: 'idle', reason: 'waiting_for_time' }

    if (!due(waiting.until)) return { kind: 'idle', reason: 'not_due' }

    return advance(graph, state, input, maxSteps, { waiting, input: { kind: 'elapsed' } })
  }

  // A wake that finds an answer prefers it to the timeout: the contact did answer, the
  // debounced turn just hadn't run yet.
  if (answers.length > 0) {
    const text = answers.map(message => message.content.text).join('\n')

    return advance(graph, state, input, maxSteps, {
      waiting,
      input: { kind: 'message', text, messages: answers, attempt: waiting.attempt },
    })
  }

  if (trigger.kind === 'message') return { kind: 'idle', reason: 'no_answer' }

  if (!due(waiting.timeoutAt)) return { kind: 'idle', reason: 'not_due' }

  return advance(graph, state, input, maxSteps, { waiting, input: { kind: 'elapsed' } })
}

interface Cursor {
  vars: Variables
  seen: MessageId | null
  waits: number
}

interface Resume {
  waiting: Waiting
  input: ResumeInput
}

function advance(
  graph: CompiledGraph,
  from: Cursor,
  input: TurnInput,
  maxSteps: number,
  resumed: Resume | null,
): Outcome {
  const say: MessageContent[] = []
  const effects: EmittedEffect[] = []
  const vars = new Map<string, Value>(Object.entries(from.vars))

  const end = (reason: EndReason, handoff: BotHandoff, detail: string | null = null): Outcome => ({
    kind: 'end',
    say,
    effects,
    state: { status: 'ended', vars: Object.fromEntries(vars), reason },
    reason,
    handoff,
    detail,
  })

  const fail = (detail: string) => end('failed', { gesture: 'return' }, detail)

  const nodeAt = (id: string) => {
    const node = graph.nodes.get(id)

    if (!node) throw new Error(`the graph has no node "${id}"`)

    return node
  }

  let node: BoundNode
  let step: BoundStep

  try {
    const scope = { vars: from.vars, now: input.now }

    if (resumed) {
      node = nodeAt(resumed.waiting.node)

      if (!node.resume) return fail(`node "${node.id}" waits but can't resume`)

      step = node.resume(scope, resumed.input)
    } else {
      node = nodeAt(graph.start)
      step = node.enter(scope)
    }
  } catch (error) {
    return fail(String(error))
  }

  let reentered = resumed !== null

  for (let visits = 1; ; visits++) {
    say.push(...step.say.map(text => ({ kind: 'text' as const, text })))

    if (step.effect !== null && node.effect !== null) {
      effects.push({ node: node.id, type: node.type, delivery: node.effect, payload: step.effect })
    }

    for (const { name, value } of step.set) {
      const declared = graph.variables.get(name)

      if (value === null) {
        vars.delete(name)
      } else if (declared === value.type) {
        vars.set(name, value)
      } else {
        return fail(
          `node "${node.id}" set ${name} (${declared ?? 'undeclared'}) to a ${value.type}`,
        )
      }
    }

    const next = step.next

    if (next.kind === 'end') {
      const { reason, handoff } = handoffOf(next.ending)

      return end(reason, handoff)
    }

    if (next.kind === 'wait') {
      if (!node.resume) return fail(`node "${node.id}" waits but can't resume`)

      const waits = from.waits + 1
      const token = `${node.id}:${waits}`

      const attempt =
        reentered && resumed?.waiting.for === 'message' ? resumed.waiting.attempt + 1 : 0

      const waiting: Waiting =
        next.wait.for === 'time'
          ? { for: 'time', node: node.id, token, until: input.now.plus(next.wait.delay) }
          : {
              for: 'message',
              node: node.id,
              token,
              timeoutAt: next.wait.timeout ? input.now.plus(next.wait.timeout) : null,
              attempt,
            }

      const at = waiting.for === 'time' ? waiting.until : waiting.timeoutAt

      return {
        kind: 'wait',
        say,
        effects,
        state: {
          status: 'waiting',
          vars: Object.fromEntries(vars),
          waiting,
          seen: newest(from.seen, input.unanswered),
          waits,
        },
        wake: at ? { at, token } : null,
      }
    }

    if (!node.ports.has(next.port)) return fail(`node "${node.id}" has no port "${next.port}"`)

    const target = graph.next.get(`${node.id}\u0000${next.port}`)

    if (target === undefined) return fail(`port "${next.port}" of "${node.id}" leads nowhere`)

    if (visits >= maxSteps) return end('step_budget_exhausted', { gesture: 'return' })

    try {
      node = nodeAt(target)
      step = node.enter({ vars: Object.fromEntries(vars), now: input.now })
      reentered = false
    } catch (error) {
      return fail(String(error))
    }
  }
}
