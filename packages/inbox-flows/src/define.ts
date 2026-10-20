import vine, { type VineObject } from '@vinejs/vine'
import type { Infer, SchemaTypes } from '@vinejs/vine/types'
import type {
  AttendantId,
  CloseReason,
  InboundMessage,
  JsonValue,
  QueueId,
} from '@enzopita/adonisjs-inbox'
import type { DateTime, DurationLike } from 'luxon'

import { checkGraph, portsOf, textOf } from './graph/check.ts'
import type {
  Catalog,
  CatalogEntry,
  EffectDelivery,
  FieldUi,
  FlowGraph,
  GraphNode,
  JsonObject,
  JsonSchema,
  Problem,
} from './graph/types.ts'
import {
  operatorsFor,
  render,
  type Value,
  type ValueOf,
  type VariableType,
  type Variables,
} from './graph/values.ts'

/**
 * A node's config is a Vine object whose output is plain JSON, so a graph stores it as is.
 */
export type ConfigSchema = VineObject<any, any, JsonObject, any>

export interface EffectDefinition<Payload extends ConfigSchema = ConfigSchema> {
  payload: Payload
  /**
   * `in_transaction`: applied in the transaction that commits the turn, so it lands exactly
   * once with the replies. Database writes only.
   * `after_commit`: stored with the turn, performed after the commit with retries and an
   * idempotency key. For IO outside your database.
   */
  delivery: EffectDelivery
}

/**
 * Declared inline on the node that emits it, so the effects a registry can emit are derived
 * from its nodes and never kept in a second list.
 */
export function defineEffect<Payload extends ConfigSchema>(effect: EffectDefinition<Payload>) {
  return effect
}

// ---------------------------------------------------------------------------------------------
// What a node sees and returns. Pure: no IO, no clock but `now`.
// ---------------------------------------------------------------------------------------------

/**
 * Bindings only fit fields that hold text, since they name a variable or are a template.
 */
export type FieldsOf<Config> = {
  readonly [Field in keyof Config]?: Config[Field] extends string | undefined
    ? FieldUi
    : Omit<FieldUi, 'binds'>
}

type BoundFields<Fields, Access extends 'writes' | 'reads'> = {
  [Field in keyof Fields]: Fields[Field] extends {
    binds: { [A in Access]: readonly VariableType[] }
  }
    ? Field
    : never
}[keyof Fields] &
  string

type AnyBound<Fields> = BoundFields<Fields, 'reads'> | BoundFields<Fields, 'writes'>

type TypesOf<Spec> = Spec extends {
  binds: { writes: readonly (infer Type extends VariableType)[] }
}
  ? Type
  : never

/**
 * Keyed by the config field that names the variable, not by the variable, so a node can only
 * set what its fields bind for writing, with a value of a type the binding allows.
 */
export type SetOf<Fields> = {
  [Field in BoundFields<Fields, 'writes'>]?: ValueOf<TypesOf<Fields[Field]>> | null
}

export interface NodeScope<Config, Fields> {
  node: string
  /**
   * Template fields are already rendered with the variables as they are now.
   */
  config: Config
  now: DateTime
  read: (field: BoundFields<Fields, 'reads'>) => Value | null
  /**
   * The declared type of the variable a bound field names.
   */
  typeOf: (field: AnyBound<Fields>) => VariableType
}

/**
 * Every run that ends hands the ticket on, so a finished flow never strands a ticket with the
 * bot: `complete` and a handoff to `own_queue` return it.
 */
export type Ending =
  | { end: 'complete' }
  | { end: 'handoff'; to: 'own_queue' | { queueId: QueueId; attendantId?: AttendantId } }
  | { end: 'close'; reason: CloseReason }

export type Wait = { for: 'message'; timeout?: DurationLike } | { for: 'time'; delay: DurationLike }

interface Output<Set, Payload> {
  say?: string[]
  set?: Set
  effect?: Payload
}

type Go<Port> = { go: Port; end?: never; wait?: never }

type End = Ending & { go?: never; wait?: never }

type Waits = { wait: Wait; go?: never; end?: never }

export type Instant<Port, Set, Payload> = Output<Set, Payload> & (Go<Port> | End)

export type Step<Port, Set, Payload> = Output<Set, Payload> & (Go<Port> | End | Waits)

/**
 * What resumes a waiting node. `messages` are only the ones sent after the node began waiting,
 * and `text` joins them by newline. `attempt` counts how often this node waited again from its
 * own `resume`, so a re-asking question needs no hidden variable.
 */
export type ResumeInput =
  | { kind: 'message'; text: string; messages: InboundMessage[]; attempt: number }
  | { kind: 'elapsed' }

// ---------------------------------------------------------------------------------------------
// The definition: one object per node kind.
// ---------------------------------------------------------------------------------------------

type OptionsField<Config> = {
  [Field in keyof Config]: Config[Field] extends ReadonlyArray<{ id: string }> ? Field : never
}[keyof Config] &
  string

export interface PortDef<Config> {
  id: string
  label?: string
  whileSet?: keyof Config & string
}

export type PortsDef<Config> = readonly PortDef<Config>[] | { from: OptionsField<Config> }

type PortOf<Ports> = Ports extends readonly { id: infer Id extends string }[] ? Id : string

type PayloadOf<Effect> = Effect extends EffectDefinition<infer Payload> ? Infer<Payload> : never

export interface NodeRule {
  field?: string
  detail: string
}

export interface NodeUi {
  label: string
  category: string
  icon?: string
  /**
   * `{{field}}` over the node's own config, for the card's caption.
   */
  summary?: string
}

interface SpecBase<Type, Schema extends ConfigSchema, Ports, Fields, Effect> {
  type: Type
  typeVersion: number
  config: Schema
  defaults: Infer<Schema>
  fields?: Fields
  ports: Ports
  effect?: Effect
  ui: NodeUi
  /**
   * From data written against an older `typeVersion` to the current one.
   */
  upgrade?: (data: JsonObject, from: number) => JsonObject
  /**
   * Publish rules the schema can't state, over the parsed config. Runs on the server only.
   */
  validate?: (
    config: Infer<Schema>,
    variables: { typeOf: (field: AnyBound<Fields>) => VariableType | null },
  ) => NodeRule[]
}

export type NodeSpec<Type, Schema extends ConfigSchema, Ports, Fields, Effect> = SpecBase<
  Type,
  Schema,
  Ports,
  Fields,
  Effect
> &
  (
    | {
        execute: (
          scope: NodeScope<Infer<Schema>, Fields>,
        ) => Instant<PortOf<Ports>, SetOf<Fields>, PayloadOf<Effect>>
        enter?: never
        resume?: never
      }
    | {
        enter: (
          scope: NodeScope<Infer<Schema>, Fields>,
        ) => Step<PortOf<Ports>, SetOf<Fields>, PayloadOf<Effect>>
        resume: (
          scope: NodeScope<Infer<Schema>, Fields>,
          input: ResumeInput,
        ) => Step<PortOf<Ports>, SetOf<Fields>, PayloadOf<Effect>>
        execute?: never
      }
  )

/**
 * One step as the interpreter runs it: ports, writes and payload are already erased to data.
 */
export interface BoundStep {
  say: string[]
  set: Array<{ name: string; value: Value | null }>
  effect: JsonValue | null
  next:
    | { kind: 'go'; port: string }
    | { kind: 'end'; ending: Ending }
    | { kind: 'wait'; wait: Wait }
}

export interface RunScope {
  vars: Variables
  now: DateTime
}

/**
 * A node of a compiled graph, closed over its parsed config.
 */
export interface BoundNode {
  id: string
  type: string
  ports: ReadonlySet<string>
  effect: EffectDelivery | null
  enter(scope: RunScope): BoundStep
  /**
   * `null` for a node that never waits, so the interpreter never resumes it.
   */
  resume: ((scope: RunScope, input: ResumeInput) => BoundStep) | null
}

export type BindResult =
  | { kind: 'bound'; node: BoundNode }
  | { kind: 'invalid'; problems: Problem[] }

/**
 * A node kind as the registry holds it. The typed spec stays inside its closures.
 */
export interface NodeType<
  Type extends string = string,
  Effect extends EffectDefinition | undefined = EffectDefinition | undefined,
> {
  readonly type: Type
  readonly typeVersion: number
  readonly effect: NonNullable<Effect> | null
  readonly catalog: CatalogEntry
  /**
   * `null` when data from that `typeVersion` can't be brought to the current one, including
   * when `upgrade` throws on it.
   */
  upgrade(node: GraphNode): GraphNode | null
  bind(node: GraphNode, declared: ReadonlyMap<string, VariableType>): Promise<BindResult>
}

type VineJsonSchema = ReturnType<ConfigSchema['toJSONSchema']>

type VineDefinition =
  NonNullable<VineJsonSchema['items']> extends infer Items
    ? Items extends readonly (infer Item)[]
      ? Item
      : Items
    : never

/**
 * Copies the keywords the catalog uses out of Vine's output, then fixes what Vine 4.4 leaves
 * lossy: an enum carries no `type`, and a boolean comes out as the enum of strings and numbers
 * its parser accepts.
 */
function fromVine(definition: VineDefinition): JsonSchema {
  if (definition === true || definition === false) return {}

  const schema: JsonSchema = {}

  if (definition.type !== undefined) schema.type = definition.type

  if (definition.enum !== undefined) schema.enum = definition.enum

  if (definition.required !== undefined) schema.required = definition.required

  if (definition.minLength !== undefined) schema.minLength = definition.minLength

  if (definition.maxLength !== undefined) schema.maxLength = definition.maxLength

  if (definition.minimum !== undefined) schema.minimum = definition.minimum

  if (definition.maximum !== undefined) schema.maximum = definition.maximum

  if (definition.pattern !== undefined) schema.pattern = definition.pattern

  if (definition.format !== undefined) schema.format = definition.format

  if (definition.anyOf !== undefined) schema.anyOf = definition.anyOf.map(fromVine)

  if (definition.additionalProperties === true || definition.additionalProperties === false) {
    schema.additionalProperties = definition.additionalProperties
  }

  if (definition.items !== undefined && !Array.isArray(definition.items)) {
    schema.items = fromVine(definition.items)
  }

  if (definition.properties !== undefined) {
    schema.properties = Object.fromEntries(
      Object.entries(definition.properties).map(([key, property]) => [key, fromVine(property)]),
    )
  }

  const values = schema.enum

  if (values === undefined || schema.type !== undefined) return schema

  if (values.includes(true) && values.includes(false)) {
    const { enum: _accepted, ...rest } = schema

    return { ...rest, type: 'boolean' }
  }

  if (values.every(value => textOf(value) !== null)) return { ...schema, type: 'string' }

  if (values.every(value => Number(value) === value)) return { ...schema, type: 'number' }

  return schema
}

/**
 * Vine leaves a `.nullable()` field out of `required` even though it must be present, so
 * `required` is rebuilt from which properties are `.optional()`.
 */
function configSchema(config: ConfigSchema, fields: FieldUis) {
  const schema = fromVine(config.toJSONSchema())
  const properties = Object.entries<SchemaTypes>(config.getProperties())

  return {
    ...schema,
    required: properties.flatMap(([key, property]) =>
      'isOptional' in property && property.isOptional === true ? [] : [key],
    ),
    properties: Object.fromEntries(
      Object.entries(schema.properties ?? {}).map(([key, property]) => {
        const ui = fields[key]

        return [key, ui ? { ...property, 'x-ui': ui } : property]
      }),
    ),
  }
}

/**
 * An entry of `ValidationError.messages`, which Vine types as `any`.
 */
interface VineMessage {
  field: string
  message: string
}

type FieldUis = { readonly [field: string]: FieldUi | undefined }

function bindingOf(ui: FieldUi | undefined) {
  const binds = ui?.binds

  if (binds === undefined || binds === 'template') return null

  return 'writes' in binds ? binds.writes : binds.reads
}

export function defineNode<
  const Type extends string,
  Schema extends ConfigSchema,
  const Ports extends PortsDef<Infer<Schema>>,
  const Fields extends FieldsOf<Infer<Schema>> = Record<never, never>,
  const Effect extends EffectDefinition | undefined = undefined,
>(
  spec: NodeSpec<Type, Schema, Ports, NoInfer<Fields>, Effect> & { fields?: Fields },
): NodeType<Type, Effect> {
  const validator = vine.create(spec.config)
  const fields: FieldUis = spec.fields ?? {}

  const templates = Object.entries(fields).flatMap(([field, ui]) =>
    ui?.binds === 'template' ? [field] : [],
  )

  const catalog: CatalogEntry = {
    type: spec.type,
    typeVersion: spec.typeVersion,
    upgradable: spec.upgrade !== undefined,
    label: spec.ui.label,
    category: spec.ui.category,
    icon: spec.ui.icon ?? null,
    summary: spec.ui.summary ?? null,
    ports: 'from' in spec.ports ? { from: spec.ports.from } : spec.ports.map(port => ({ ...port })),
    entry: spec.type === 'start',
    terminal: !('from' in spec.ports) && spec.ports.length === 0,
    waits: spec.resume !== undefined,
    effect: spec.effect ? { delivery: spec.effect.delivery } : null,
    defaults: spec.defaults,
    schema: configSchema(spec.config, fields),
  }

  const bind = async (node: GraphNode, declared: ReadonlyMap<string, VariableType>) => {
    const problems: Problem[] = []
    const [error, config] = await validator.tryValidate(node.data)

    if (error) {
      const messages: VineMessage[] = error.messages

      return {
        kind: 'invalid',
        problems: messages.map(({ field, message }) => ({
          code: 'config_invalid',
          severity: 'impediment',
          nodeId: node.id,
          field,
          detail: message,
        })),
      } satisfies BindResult
    }

    const bound = new Map<string, { name: string; type: VariableType }>()

    for (const [field, ui] of Object.entries(fields)) {
      const accepts = bindingOf(ui)
      const name = textOf(node.data[field])

      if (accepts === null || name === null) continue

      const type = declared.get(name)

      if (type === undefined || !accepts.includes(type)) {
        problems.push({
          code: type === undefined ? 'variable_undeclared' : 'variable_type_mismatch',
          severity: 'impediment',
          nodeId: node.id,
          field,
          detail: name,
        })
        continue
      }

      bound.set(field, { name, type })
    }

    const typeOf = (field: string) => {
      const variable = bound.get(field)

      if (!variable) throw new Error(`field "${field}" binds no declared variable`)

      return variable.type
    }

    for (const rule of spec.validate?.(config, {
      typeOf: field => bound.get(field)?.type ?? null,
    }) ?? []) {
      problems.push({ code: 'node_rule', severity: 'impediment', nodeId: node.id, ...rule })
    }

    if (problems.length > 0) return { kind: 'invalid', problems } satisfies BindResult

    const scope = (run: RunScope): NodeScope<Infer<Schema>, Fields> => {
      const rendered = { ...config }

      for (const field of templates) {
        const template = textOf(node.data[field])

        if (template !== null) Object.assign(rendered, { [field]: render(template, run.vars) })
      }

      return {
        node: node.id,
        config: rendered,
        now: run.now,
        read: field => {
          const variable = bound.get(field)

          return variable ? (run.vars[variable.name] ?? null) : null
        },
        typeOf,
      }
    }

    const next = (step: Step<PortOf<Ports>, SetOf<Fields>, PayloadOf<Effect>>) => {
      if (step.wait !== undefined) return { kind: 'wait', wait: step.wait } as const

      if (step.end === undefined) return { kind: 'go', port: step.go } as const

      switch (step.end) {
        case 'complete':
          return { kind: 'end', ending: { end: step.end } } as const
        case 'handoff':
          return { kind: 'end', ending: { end: step.end, to: step.to } } as const
        case 'close':
          return { kind: 'end', ending: { end: step.end, reason: step.reason } } as const
      }
    }

    const erase = (step: Step<PortOf<Ports>, SetOf<Fields>, PayloadOf<Effect>>): BoundStep => ({
      say: step.say ?? [],
      set: Object.entries<Value | null | undefined>(step.set ?? {}).flatMap(([field, value]) => {
        const name = bound.get(field)?.name

        return name === undefined ? [] : [{ name, value: value ?? null }]
      }),
      effect: step.effect ?? null,
      next: next(step),
    })

    const { execute, enter, resume } = spec

    return {
      kind: 'bound',
      node: {
        id: node.id,
        type: node.type,
        ports: new Set(portsOf(catalog, node.data)),
        effect: spec.effect?.delivery ?? null,
        enter: run => erase(execute ? execute(scope(run)) : enter(scope(run))),
        resume: resume ? (run, input) => erase(resume(scope(run), input)) : null,
      },
    } satisfies BindResult
  }

  return {
    type: spec.type,
    typeVersion: spec.typeVersion,
    effect: spec.effect ?? null,
    catalog,
    upgrade: node => {
      if (node.typeVersion === spec.typeVersion) return node

      if (node.typeVersion > spec.typeVersion || !spec.upgrade) return null

      try {
        return {
          ...node,
          typeVersion: spec.typeVersion,
          data: spec.upgrade(node.data, node.typeVersion),
        }
      } catch {
        return null
      }
    },
    bind,
  }
}

// ---------------------------------------------------------------------------------------------
// The registry.
// ---------------------------------------------------------------------------------------------

/**
 * A pinned version bound once. Versions are immutable, so a compiled graph never goes stale.
 */
export interface CompiledGraph {
  start: string
  nodes: ReadonlyMap<string, BoundNode>
  /**
   * `${source}\u0000${port}` to the target. One edge per port, by `checkGraph`.
   */
  next: ReadonlyMap<string, string>
  variables: ReadonlyMap<string, VariableType>
}

export type CompileResult =
  | { kind: 'compiled'; graph: CompiledGraph }
  | { kind: 'invalid'; problems: Problem[] }

/**
 * The payload type of each node type that declares an effect, for typing effect handlers.
 */
export type EffectsOf<Nodes extends readonly NodeType[]> = {
  [
    Node in Nodes[number] as [NonNullable<Node['effect']>] extends [never] ? never : Node['type']
  ]: PayloadOf<NonNullable<Node['effect']>>
}

export interface NodeRegistry<Nodes extends readonly NodeType[]> {
  readonly nodes: Nodes
  /**
   * Plain JSON, built once: what `GET /catalog` serves and what `checkGraph` reads.
   */
  readonly catalog: Catalog
  /**
   * The node types that emit an effect, with how it is delivered.
   */
  readonly effects: ReadonlyMap<string, EffectDefinition>
  /**
   * Brings every node it can to its current `typeVersion`. The rest keep theirs, and the
   * publish checks report them.
   */
  upgrade(graph: FlowGraph): FlowGraph
  /**
   * `checkGraph` over the upgraded graph, plus in `publish` mode what needs the definitions:
   * each config under its Vine schema, the variables its fields bind, and its `validate` rule.
   */
  check(graph: FlowGraph, mode: 'draft' | 'publish'): Promise<Problem[]>
  compile(graph: FlowGraph): Promise<CompileResult>
}

export function defineNodes<const Nodes extends readonly NodeType[]>(
  nodes: Nodes,
): NodeRegistry<Nodes> {
  const types = new Map<string, NodeType>()

  for (const node of nodes) {
    if (types.has(node.type)) throw new Error(`node type "${node.type}" is defined twice`)

    types.set(node.type, node)
  }

  if (!types.has('start')) throw new Error('a node registry needs the "start" node')

  const registry: NodeRegistry<Nodes> = {
    nodes,
    catalog: {
      schemaVersion: 1,
      nodes: nodes.map(node => node.catalog),
      operators: {
        text: operatorsFor('text'),
        number: operatorsFor('number'),
        boolean: operatorsFor('boolean'),
      },
    },
    effects: new Map(
      nodes.flatMap(node => (node.effect === null ? [] : [[node.type, node.effect]])),
    ),
    upgrade: graph => ({
      ...graph,
      nodes: graph.nodes.map(node => types.get(node.type)?.upgrade(node) ?? node),
    }),
    check: async (graph, mode) => {
      const result = await compile(graph, mode)

      return result.problems
    },
    compile: async graph => {
      const result = await compile(graph, 'publish')

      return result.graph && !result.problems.some(({ severity }) => severity === 'impediment')
        ? { kind: 'compiled', graph: result.graph }
        : { kind: 'invalid', problems: result.problems }
    },
  }

  async function compile(source: FlowGraph, mode: 'draft' | 'publish') {
    const graph = registry.upgrade(source)
    const problems = checkGraph(registry.catalog, graph, mode)

    if (mode === 'draft' || problems.some(({ severity }) => severity === 'impediment')) {
      return { problems, graph: null }
    }

    const declared = new Map(graph.variables.map(({ name, type }) => [name, type]))
    const bound = new Map<string, BoundNode>()

    for (const node of graph.nodes) {
      const definition = types.get(node.type)

      if (!definition) continue

      const result = await definition.bind(node, declared)

      if (result.kind === 'invalid') problems.push(...result.problems)
      else bound.set(node.id, result.node)
    }

    const start = graph.nodes.find(node => node.type === 'start')

    if (!start) return { problems, graph: null }

    return {
      problems,
      graph: {
        start: start.id,
        nodes: bound,
        next: new Map(
          graph.edges.map(edge => [`${edge.source}\u0000${edge.sourceHandle}`, edge.target]),
        ),
        variables: declared,
      } satisfies CompiledGraph,
    }
  }

  return registry
}
