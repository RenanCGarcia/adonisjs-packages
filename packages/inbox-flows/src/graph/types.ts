import type { JsonValue } from '@enzopita/adonisjs-inbox'

import type { OperatorEntry, VariableType } from './values.ts'

export type JsonObject = { [key: string]: JsonValue }

/**
 * xyflow's own field names, so `<ReactFlow nodes edges>` loads a graph without remapping.
 */
export interface GraphNode {
  id: string
  type: string
  /**
   * The definition version `data` was written against. An older one is upgraded when the graph
   * compiles, so a pinned version keeps running after its node types move on.
   */
  typeVersion: number
  /**
   * Layout only. Left out of the publish identity, so moving a node never makes a version.
   */
  position: { x: number; y: number }
  data: JsonObject
}

/**
 * `sourceHandle` is the port. Every node has one unnamed input, so there is no `targetHandle`.
 */
export interface GraphEdge {
  id: string
  source: string
  sourceHandle: string
  target: string
}

export interface VariableDeclaration {
  name: string
  type: VariableType
}

export interface FlowGraph {
  schemaVersion: 1
  variables: VariableDeclaration[]
  nodes: GraphNode[]
  edges: GraphEdge[]
}

export const GRAPH_LIMITS = { nodes: 500, edges: 1000, variables: 100 } as const

export const VARIABLE_NAME = /^[a-z][a-z0-9_]{0,63}$/

/**
 * What a config field means to the interpreter, the checks and the editor at once:
 *
 * - `template`: `{{name}}` placeholders, rendered before the node runs; each one is a read;
 * - `writes`: the field holds the name of a variable the node sets, of one of these types;
 * - `reads`: the field holds the name of a variable the node reads, of one of these types.
 */
export type FieldBinding =
  | 'template'
  | { writes: readonly VariableType[] }
  | { reads: readonly VariableType[] }

export type FieldWidget =
  | 'text'
  | 'textarea'
  | 'number'
  | 'switch'
  | 'select'
  | 'duration'
  | 'queue'
  | 'attendant'

/**
 * Merged into the catalog's JSON Schema as `x-ui`. It never goes through Vine's `.meta()`, whose
 * 4.4 parser lets `null` through on scalar fields.
 */
export interface FieldUi {
  label: string
  help?: string
  placeholder?: string
  widget?: FieldWidget
  binds?: FieldBinding
}

/**
 * The draft-7 subset Vine emits, plus `x-ui`. A local interface, as in `packages/openapi`.
 */
export interface JsonSchema {
  'type'?: string | string[]
  'properties'?: { [key: string]: JsonSchema }
  'required'?: string[]
  'additionalProperties'?: boolean
  'items'?: JsonSchema
  'enum'?: JsonValue[]
  'anyOf'?: JsonSchema[]
  'minLength'?: number
  'maxLength'?: number
  'minimum'?: number
  'maximum'?: number
  'pattern'?: string
  'format'?: string
  'x-ui'?: FieldUi
}

/**
 * A port the node always has, or one that only exists while a config field is set, such as
 * the question's `timeout`.
 */
export interface PortEntry {
  id: string
  label?: string
  whileSet?: string
}

/**
 * Static ports, or one port per item of an array field of `{ id, label? }`, for menus.
 */
export type CatalogPorts = PortEntry[] | { from: string }

export interface CatalogEntry {
  type: string
  typeVersion: number
  /**
   * Whether data written against an older `typeVersion` can be upgraded.
   */
  upgradable: boolean
  label: string
  category: string
  icon: string | null
  /**
   * `{{field}}` over the node's own config, for the card's one-line caption.
   */
  summary: string | null
  ports: CatalogPorts
  /**
   * The `start` node: exactly one per graph, not deletable, nothing points at it.
   */
  entry: boolean
  /**
   * No ports: the run ends here.
   */
  terminal: boolean
  waits: boolean
  effect: { delivery: EffectDelivery } | null
  defaults: JsonObject
  schema: JsonSchema
}

export type EffectDelivery = 'in_transaction' | 'after_commit'

export interface Catalog {
  schemaVersion: 1
  nodes: CatalogEntry[]
  operators: { [Type in VariableType]: OperatorEntry[] }
}

export type ProblemCode =
  | 'too_large'
  | 'duplicate_node_id'
  | 'duplicate_edge_id'
  | 'duplicate_variable'
  | 'invalid_variable_name'
  | 'start_count'
  | 'edge_dangling'
  | 'edge_into_start'
  | 'edge_from_terminal'
  | 'unknown_port'
  | 'port_taken'
  | 'unknown_type'
  | 'unsupported_type_version'
  | 'port_unconnected'
  | 'unreachable'
  | 'no_way_to_end'
  | 'config_required'
  | 'config_invalid'
  | 'variable_undeclared'
  | 'variable_type_mismatch'
  | 'variable_maybe_unset'
  | 'node_rule'

export interface Problem {
  code: ProblemCode
  severity: 'impediment' | 'warning'
  nodeId?: string
  edgeId?: string
  field?: string
  detail?: string
}
