import type { JsonValue } from '@enzopita/adonisjs-inbox'

import {
  GRAPH_LIMITS,
  VARIABLE_NAME,
  type Catalog,
  type CatalogEntry,
  type FlowGraph,
  type GraphNode,
  type JsonObject,
  type JsonSchema,
  type Problem,
  type ProblemCode,
} from './types.ts'
import { templateReads, type VariableType } from './values.ts'

function isObject(value: JsonValue): value is JsonObject {
  return value !== null && !Array.isArray(value) && Object(value) === value
}

/**
 * A JSON string, or `null`. Past objects and arrays, comparing with its own `String()` tells a
 * string from a number or a boolean without asking `typeof`.
 */
export function textOf(value: JsonValue | undefined): string | null {
  if (value === undefined || value === null || Array.isArray(value) || isObject(value)) return null

  return value === String(value) ? value : null
}

function isBlank(value: JsonValue | undefined) {
  return value === undefined || value === null || textOf(value)?.trim() === ''
}

/**
 * A `.nullable()` field is filled by `null`; any other required field is not.
 */
function isMissing(schema: JsonSchema | undefined, value: JsonValue | undefined) {
  const type = schema?.type
  const nullable = type === 'null' || (Array.isArray(type) && type.includes('null'))

  return value === null ? !nullable : isBlank(value)
}

/**
 * A node's ports for its current `data`. The editor draws one handle per id.
 */
export function portsOf(entry: CatalogEntry, data: JsonObject): string[] {
  if (Array.isArray(entry.ports)) {
    return entry.ports
      .filter(port => port.whileSet === undefined || !isBlank(data[port.whileSet]))
      .map(port => port.id)
  }

  const items = data[entry.ports.from]

  if (!Array.isArray(items)) return []

  return items.flatMap(item => {
    const id = isObject(item) ? textOf(item.id) : null

    return id === null ? [] : [id]
  })
}

/**
 * A template renders an unset variable as '', which is what the maybe-unset warning is about. A
 * condition reading one is fine: `is_set` exists for that.
 */
interface NodeVariables {
  writes: string[]
  renders: string[]
}

function variablesOf(entry: CatalogEntry, data: JsonObject) {
  const found: Array<{ field: string; name: string; access: 'writes' | 'reads' | 'renders' }> = []
  const types: Array<{ field: string; name: string; accepts: readonly VariableType[] }> = []

  for (const [field, schema] of Object.entries(entry.schema.properties ?? {})) {
    const binds = schema['x-ui']?.binds
    const value = textOf(data[field])

    if (binds === undefined || value === null || value.trim() === '') continue

    if (binds === 'template') {
      for (const name of templateReads(value)) found.push({ field, name, access: 'renders' })
    } else if ('writes' in binds) {
      found.push({ field, name: value, access: 'writes' })
      types.push({ field, name: value, accepts: binds.writes })
    } else {
      found.push({ field, name: value, access: 'reads' })
      types.push({ field, name: value, accepts: binds.reads })
    }
  }

  return { found, types }
}

const WARNINGS: ReadonlySet<ProblemCode> = new Set(['variable_maybe_unset'])

/**
 * Every problem at once, never throwing. Imports neither Vine nor Lucid, so the editor runs it
 * on the catalog JSON and shows what the server would report.
 *
 * - `draft`: what makes a graph malformed, so a half-built graph still saves: duplicate ids,
 *   the start count, edges that dangle, enter the start, leave a terminal, use an unknown port
 *   or a port twice, and invalid or duplicate variables.
 * - `publish`: also unknown node types and versions, unconnected ports, reachability, a way to
 *   end from every node, required config fields, and the variables each field binds.
 *
 * Config validity under Vine and each node's `validate` rule need the definitions, so they run
 * on the server only, in `registry.check()`.
 */
export function checkGraph(catalog: Catalog, graph: FlowGraph, mode: 'draft' | 'publish') {
  const problems: Problem[] = []

  const report = (code: ProblemCode, at: Omit<Problem, 'code' | 'severity'> = {}) => {
    problems.push({ code, severity: WARNINGS.has(code) ? 'warning' : 'impediment', ...at })
  }

  if (
    graph.nodes.length > GRAPH_LIMITS.nodes ||
    graph.edges.length > GRAPH_LIMITS.edges ||
    graph.variables.length > GRAPH_LIMITS.variables
  ) {
    report('too_large')

    return problems
  }

  const declared = new Map<string, VariableType>()

  for (const variable of graph.variables) {
    if (!VARIABLE_NAME.test(variable.name)) {
      report('invalid_variable_name', { detail: variable.name })
    } else if (declared.has(variable.name)) {
      report('duplicate_variable', { detail: variable.name })
    } else {
      declared.set(variable.name, variable.type)
    }
  }

  const entries = new Map(catalog.nodes.map(entry => [entry.type, entry]))
  const nodes = new Map<string, { node: GraphNode; entry: CatalogEntry | null }>()

  for (const node of graph.nodes) {
    if (nodes.has(node.id)) {
      report('duplicate_node_id', { nodeId: node.id })
      continue
    }

    nodes.set(node.id, { node, entry: entries.get(node.type) ?? null })
  }

  const starts = [...nodes.values()].filter(({ entry }) => entry?.entry === true)

  if (starts.length !== 1) report('start_count', { detail: String(starts.length) })

  const edgeIds = new Set<string>()
  const taken = new Set<string>()
  const successors = new Map<string, string[]>()

  for (const edge of graph.edges) {
    if (edgeIds.has(edge.id)) {
      report('duplicate_edge_id', { edgeId: edge.id })
      continue
    }

    edgeIds.add(edge.id)

    const source = nodes.get(edge.source)
    const target = nodes.get(edge.target)

    if (!source || !target) {
      report('edge_dangling', { edgeId: edge.id })
      continue
    }

    if (target.entry?.entry) {
      report('edge_into_start', { edgeId: edge.id, nodeId: edge.target })
      continue
    }

    if (source.entry?.terminal) {
      report('edge_from_terminal', { edgeId: edge.id, nodeId: edge.source })
      continue
    }

    if (source.entry && !portsOf(source.entry, source.node.data).includes(edge.sourceHandle)) {
      report('unknown_port', { edgeId: edge.id, nodeId: edge.source, detail: edge.sourceHandle })
      continue
    }

    const port = `${edge.source}\u0000${edge.sourceHandle}`

    if (taken.has(port)) {
      report('port_taken', { edgeId: edge.id, nodeId: edge.source, detail: edge.sourceHandle })
      continue
    }

    taken.add(port)
    successors.set(edge.source, [...(successors.get(edge.source) ?? []), edge.target])
  }

  if (mode === 'draft') return problems

  const variables = new Map<string, NodeVariables>()

  for (const { node, entry } of nodes.values()) {
    if (!entry) {
      report('unknown_type', { nodeId: node.id, detail: node.type })
      continue
    }

    if (
      node.typeVersion > entry.typeVersion ||
      (node.typeVersion < entry.typeVersion && !entry.upgradable)
    ) {
      report('unsupported_type_version', { nodeId: node.id, detail: String(node.typeVersion) })
    }

    for (const port of portsOf(entry, node.data)) {
      if (!taken.has(`${node.id}\u0000${port}`)) {
        report('port_unconnected', { nodeId: node.id, detail: port })
      }
    }

    for (const field of entry.schema.required ?? []) {
      if (isMissing(entry.schema.properties?.[field], node.data[field])) {
        report('config_required', { nodeId: node.id, field })
      }
    }

    const { found, types } = variablesOf(entry, node.data)

    for (const { field, name } of found) {
      if (!declared.has(name))
        report('variable_undeclared', { nodeId: node.id, field, detail: name })
    }

    for (const { field, name, accepts } of types) {
      const type = declared.get(name)

      if (type !== undefined && !accepts.includes(type)) {
        report('variable_type_mismatch', { nodeId: node.id, field, detail: name })
      }
    }

    variables.set(node.id, {
      writes: found.filter(({ access }) => access === 'writes').map(({ name }) => name),
      renders: found.filter(({ access }) => access === 'renders').map(({ name }) => name),
    })
  }

  const ends = waysToEnd(nodes, successors)

  for (const { node, entry } of nodes.values()) {
    if (entry && !ends.has(node.id)) report('no_way_to_end', { nodeId: node.id })
  }

  if (starts.length !== 1) return problems

  const start = starts[0].node.id
  const entering = setOnEveryPath(start, successors, variables)

  for (const { node } of nodes.values()) {
    const sure = entering.get(node.id)

    if (!sure) {
      report('unreachable', { nodeId: node.id })
      continue
    }

    for (const name of variables.get(node.id)?.renders ?? []) {
      if (declared.has(name) && !sure.has(name)) {
        report('variable_maybe_unset', { nodeId: node.id, detail: name })
      }
    }
  }

  return problems
}

/**
 * Terminals, then every node with a successor already in the set, until nothing grows. A
 * cycle with an exit passes; a cycle without one does not.
 */
function waysToEnd(
  nodes: ReadonlyMap<string, { entry: CatalogEntry | null }>,
  successors: ReadonlyMap<string, string[]>,
) {
  const ending = new Set([...nodes].flatMap(([id, { entry }]) => (entry?.terminal ? [id] : [])))

  let grew = true

  while (grew) {
    grew = false

    for (const id of nodes.keys()) {
      if (ending.has(id)) continue

      if ((successors.get(id) ?? []).some(target => ending.has(target))) {
        ending.add(id)
        grew = true
      }
    }
  }

  return ending
}

/**
 * The variables set on every path from the start into each node, over the reachable nodes. A
 * node's set is first taken from the predecessors known so far and only ever shrinks after
 * that, so a cyclic graph terminates.
 */
function setOnEveryPath(
  start: string,
  successors: ReadonlyMap<string, string[]>,
  variables: ReadonlyMap<string, NodeVariables>,
) {
  const entering = new Map<string, ReadonlySet<string>>([[start, new Set()]])
  const queue = [start]

  while (queue.length > 0) {
    const id = queue.shift()!
    const incoming = entering.get(id)!
    const leaving = new Set([...incoming, ...(variables.get(id)?.writes ?? [])])

    for (const target of successors.get(id) ?? []) {
      const current = entering.get(target)
      const next = current ? new Set([...current].filter(name => leaving.has(name))) : leaving

      if (current && next.size === current.size) continue

      entering.set(target, next)
      queue.push(target)
    }
  }

  return entering
}

function canonical(value: JsonValue): JsonValue {
  if (Array.isArray(value)) return value.map(canonical)

  if (!isObject(value)) return value

  return Object.fromEntries(
    Object.keys(value)
      .sort()
      .map(key => [key, canonical(value[key])]),
  )
}

const byText = (left: string, right: string) => (left < right ? -1 : left > right ? 1 : 0)

/**
 * The publish identity as text: everything that changes how a run behaves, nothing that only
 * changes the picture. Positions and edge ids are left out, nodes, edges and variables are
 * sorted, and config keys too, so dragging or reconnecting the same port never makes a version.
 */
export function canonicalGraph(graph: FlowGraph): string {
  return JSON.stringify({
    schemaVersion: graph.schemaVersion,
    variables: graph.variables
      .map(({ name, type }) => ({ name, type }))
      .sort((left, right) => byText(left.name, right.name)),
    nodes: graph.nodes
      .map(({ id, type, typeVersion, data }) => ({ id, type, typeVersion, data: canonical(data) }))
      .sort((left, right) => byText(left.id, right.id)),
    edges: graph.edges
      .map(({ source, sourceHandle, target }) => [source, sourceHandle, target])
      .sort((left, right) => byText(left.join('\u0000'), right.join('\u0000'))),
  })
}
