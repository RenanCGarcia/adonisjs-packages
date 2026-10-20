import type { InboundMessage, MessageId } from '@enzopita/adonisjs-inbox'
import { DateTime } from 'luxon'

import {
  builtins,
  defineNodes,
  runTurn,
  type CompiledGraph,
  type FlowGraph,
  type JsonObject,
  type NodeRegistry,
  type NodeType,
  type Outcome,
  type RunState,
  type Trigger,
  type VariableDeclaration,
} from '../index.ts'

export const t0 = DateTime.fromISO('2026-03-02T09:00:00Z')

export interface GraphSpec {
  variables?: VariableDeclaration[]
  nodes: ReadonlyArray<readonly [id: string, type: string, data?: JsonObject]>
  edges?: ReadonlyArray<readonly [source: string, port: string, target: string]>
}

/**
 * Edge ids and positions are derived, since no rule but the duplicate-id one reads them.
 */
export function graph(spec: GraphSpec): FlowGraph {
  return {
    schemaVersion: 1,
    variables: spec.variables ?? [],
    nodes: spec.nodes.map(([id, type, data = {}], index) => ({
      id,
      type,
      typeVersion: 1,
      position: { x: index * 200, y: 0 },
      data,
    })),
    edges: (spec.edges ?? []).map(([source, sourceHandle, target]) => ({
      id: `${source}-${sourceHandle}-${target}`,
      source,
      sourceHandle,
      target,
    })),
  }
}

export function inbound(id: number, text: string): InboundMessage {
  // SAFETY: fixture ids only need to be distinct, increasing numbers.
  return { id: id as MessageId, content: { kind: 'text', text }, sentAt: t0 }
}

/**
 * An effect handler for nodes whose effects these specs only look at as data.
 */
export class Discard {
  async apply() {}

  async deliver() {}
}

export const registry = defineNodes(builtins)

export async function compiled(
  flow: FlowGraph,
  nodes: NodeRegistry<readonly NodeType[]> = registry,
): Promise<CompiledGraph> {
  const result = await nodes.compile(flow)

  if (result.kind === 'invalid') {
    throw new Error(`the fixture graph doesn't compile: ${JSON.stringify(result.problems)}`)
  }

  return result.graph
}

/**
 * Drives one run turn by turn, the way the bot will: each turn's state feeds the next.
 */
export class Conversation {
  state: RunState = { status: 'fresh', vars: {} }
  unanswered: InboundMessage[] = []
  now = t0
  #nextId = 1

  constructor(
    readonly flow: CompiledGraph,
    readonly maxSteps?: number,
  ) {}

  turn(trigger: Trigger): Outcome {
    const outcome = runTurn(
      this.flow,
      this.state,
      { trigger, unanswered: this.unanswered, now: this.now },
      this.maxSteps,
    )

    if (outcome.kind !== 'idle') {
      this.state = outcome.state

      if (outcome.say.length > 0) this.unanswered = []
    }

    return outcome
  }

  /**
   * The contact writes; the inbox then runs a `message` turn.
   */
  write(text: string): Outcome {
    this.unanswered = [...this.unanswered, inbound(this.#nextId++, text)]

    return this.turn({ kind: 'message' })
  }
}

export function said(outcome: Outcome) {
  return outcome.kind === 'idle' ? [] : outcome.say.map(({ text }) => text)
}
