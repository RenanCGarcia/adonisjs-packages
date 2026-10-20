import {
  holder,
  type Actor,
  type HostUserId,
  type Rejection,
  type TicketId,
} from '@enzopita/adonisjs-inbox'
import { DateTime } from 'luxon'

import { BINDING_VARIABLES, conditionProblem, type Binding, type BindingInput } from './bindings.ts'
import { textOf } from './graph/check.ts'
import type { Catalog, FlowGraph, Problem } from './graph/types.ts'
import { graphHash } from './graph_hash.ts'
import type { InboxFlowRow } from './mixins/flow.ts'
import { lostReason, startToken, wakeToken, type FlowRun, type RunEndReason } from './run.ts'
import type { FlowsRuntime } from './runtime.ts'
import { affectedRows, Conflict, sqlTime } from './sql.ts'
import type { FlowId, FlowVersionId } from './types.ts'

/**
 * How many rows of each kind one `tick` works through at most. The rest wait for the next one.
 */
export const TICK_BATCH = 100

const ATTEMPTS = 3

export type FlowView = InboxFlowRow

export interface FlowVersionView {
  id: FlowVersionId
  flowId: FlowId
  number: number
  graph: FlowGraph
  hash: string
  publishedBy: string | null
  publishedAt: DateTime
}

/**
 * The registry's catalog, plus what the editor needs to offer for the fields only the host knows.
 */
export interface FlowsCatalog extends Catalog {
  closeReasons: string[]
  bindingVariables: typeof BINDING_VARIABLES
}

export type SaveDraftResult =
  | { outcome: 'saved'; revision: number; problems: Problem[] }
  | { outcome: 'invalid'; problems: Problem[] }
  | { outcome: 'stale'; flow: FlowView }

export type PublishResult =
  | { outcome: 'published'; version: FlowVersionView }
  | { outcome: 'unchanged'; version: FlowVersionView }
  | { outcome: 'invalid'; problems: Problem[] }
  | { outcome: 'conflict' }

export type BindingsResult =
  | { outcome: 'saved'; bindings: Binding[] }
  | { outcome: 'invalid'; problems: Array<{ index: number; detail: string }> }

export type StartResult =
  | { outcome: 'started'; run: FlowRun }
  | { outcome: 'rejected'; reason: Rejection | 'not_published' }

export type StopResult = { outcome: 'stopped'; run: FlowRun } | { outcome: 'not_running' }

export interface FlowsTickReport {
  ended: Partial<Record<RunEndReason, number>>
  woken: number
  effects: { delivered: number; retried: number; failed: number }
}

/**
 * The `inboxFlows` service: authoring, activation, manual starts and the tick. Running a flow is
 * the flows bot's job, through the inbox.
 */
export class InboxFlows {
  readonly #runtime: FlowsRuntime

  constructor(runtime: FlowsRuntime) {
    this.#runtime = runtime
  }

  catalog(): FlowsCatalog {
    const { nodes, closeReasons } = this.#runtime.config

    return {
      ...nodes.catalog,
      closeReasons: [...closeReasons],
      bindingVariables: BINDING_VARIABLES,
    }
  }

  readonly flows = {
    /**
     * A flow whose draft is a lone start node.
     */
    create: async (name: string): Promise<FlowView> => {
      const Flow = await this.#runtime.model('flow')

      const flow = await Flow.create({
        name,
        draft: {
          schemaVersion: 1,
          variables: [],
          nodes: [
            { id: 'start', type: 'start', typeVersion: 1, position: { x: 0, y: 0 }, data: {} },
          ],
          edges: [],
        },
        draftRevision: 0,
        publishedVersionId: null,
      })

      return view(flow)
    },

    get: async (id: FlowId): Promise<FlowView> => {
      const Flow = await this.#runtime.model('flow')

      return view(await Flow.findOrFail(id))
    },

    list: async (): Promise<FlowView[]> => {
      const Flow = await this.#runtime.model('flow')
      const flows = await Flow.query().orderBy('id')

      return flows.map(view)
    },
  }

  readonly drafts = {
    /**
     * Saves `graph` over the draft at `revision`, the one the editor loaded. A graph that is
     * malformed is refused. One that is only incomplete saves, and its publish problems come
     * back with it.
     */
    save: async (id: FlowId, graph: FlowGraph, revision: number): Promise<SaveDraftResult> => {
      const { nodes } = this.#runtime.config
      const malformed = await nodes.check(graph, 'draft')

      if (malformed.some(({ severity }) => severity === 'impediment')) {
        return { outcome: 'invalid', problems: malformed }
      }

      return this.#writeDraft(id, graph, revision)
    },

    /**
     * Every problem that blocks publishing the draft, the host's own rules included.
     */
    validate: async (id: FlowId): Promise<Problem[]> => {
      const Flow = await this.#runtime.model('flow')
      const flow = await Flow.findOrFail(id)

      return this.#publishProblems(id, this.#runtime.config.nodes.upgrade(flow.draft))
    },
  }

  /**
   * Publishes the draft as the flow's next version. Running runs keep the version they started
   * on. A draft whose logic matches the published version, positions aside, publishes nothing.
   */
  async publish(id: FlowId, publishedBy: HostUserId | null = null): Promise<PublishResult> {
    const Flow = await this.#runtime.model('flow')
    const FlowVersion = await this.#runtime.model('flowVersion')

    for (let attempt = 0; attempt < ATTEMPTS; attempt++) {
      const flow = await Flow.findOrFail(id)
      const graph = this.#runtime.config.nodes.upgrade(flow.draft)
      const problems = await this.#publishProblems(id, graph)

      if (problems.some(({ severity }) => severity === 'impediment')) {
        return { outcome: 'invalid', problems }
      }

      const hash = graphHash(graph)

      const current =
        flow.publishedVersionId === null ? null : await FlowVersion.find(flow.publishedVersionId)

      if (current !== null && current.hash === hash) {
        return { outcome: 'unchanged', version: versionView(current) }
      }

      const latest = await FlowVersion.query().where('flowId', id).orderBy('number', 'desc').first()
      const number = (latest?.number ?? 0) + 1

      try {
        const version = await this.#runtime.db.transaction(async trx => {
          const row = await FlowVersion.create(
            {
              flowId: id,
              number,
              graph,
              hash,
              publishedBy: publishedBy === null ? null : String(publishedBy),
            },
            { client: trx },
          )

          const moved = await Flow.query({ client: trx })
            .where('id', id)
            .where('draftRevision', flow.draftRevision)
            .where(published =>
              flow.publishedVersionId === null
                ? published.whereNull('publishedVersionId')
                : published.where('publishedVersionId', flow.publishedVersionId),
            )
            .update({ publishedVersionId: row.id })

          if (affectedRows(moved) === 0) throw new Conflict()

          return row
        })

        return { outcome: 'published', version: versionView(version) }
      } catch (error) {
        const taken = await FlowVersion.query().where('flowId', id).where('number', number).first()

        if (!(error instanceof Conflict) && taken === null) throw error
      }
    }

    return { outcome: 'conflict' }
  }

  readonly versions = {
    list: async (id: FlowId): Promise<FlowVersionView[]> => {
      const FlowVersion = await this.#runtime.model('flowVersion')
      const versions = await FlowVersion.query().where('flowId', id).orderBy('number', 'desc')

      return versions.map(versionView)
    },

    /**
     * Copies a version's graph, positions included, over the draft at `revision`. Publishing it
     * then makes it live again as a new version.
     */
    restore: async (
      id: FlowId,
      versionId: FlowVersionId,
      revision: number,
    ): Promise<SaveDraftResult> => {
      const FlowVersion = await this.#runtime.model('flowVersion')

      const version = await FlowVersion.query()
        .where('id', versionId)
        .where('flowId', id)
        .firstOrFail()

      return this.#writeDraft(id, version.graph, revision)
    },
  }

  readonly bindings = {
    /**
     * Replaces the flow's bindings. On the turn the flows bot gets a ticket no run is waiting
     * on, it starts the flow of the first binding, by priority, whose channel, queue and
     * condition hold.
     */
    set: async (id: FlowId, inputs: BindingInput[]): Promise<BindingsResult> => {
      const problems = inputs.flatMap((input, index) => {
        const detail = input.condition === null ? null : conditionProblem(input.condition)

        return detail === null ? [] : [{ index, detail }]
      })

      if (problems.length > 0) return { outcome: 'invalid', problems }

      const Flow = await this.#runtime.model('flow')
      const FlowBinding = await this.#runtime.model('flowBinding')

      await Flow.findOrFail(id)

      const rows = await this.#runtime.db.transaction(async trx => {
        await FlowBinding.query({ client: trx }).where('flowId', id).delete()

        return FlowBinding.createMany(
          inputs.map(input => ({ ...input, flowId: id })),
          { client: trx },
        )
      })

      return { outcome: 'saved', bindings: rows.map(row => row.asBinding) }
    },

    list: async (id: FlowId): Promise<Binding[]> => {
      const FlowBinding = await this.#runtime.model('flowBinding')
      const rows = await FlowBinding.query().where('flowId', id).orderBy('id')

      return rows.map(row => row.asBinding)
    },
  }

  /**
   * Starts the flow's published version on the ticket, whoever holds it, and ignores the
   * bindings and what earlier runs ended as: a person asked for it. The run waits as `pending`
   * until the flows bot's next turn enters it. A ticket the bot holds is woken; any other ticket
   * is assigned to the bot as `actor`, so `config.authorize` decides. A run already live on the
   * ticket ends `replaced`, or `taken_over` when the bot no longer held it.
   */
  async start(ticketId: TicketId, flowId: FlowId, actor: Actor): Promise<StartResult> {
    const runtime = this.#runtime
    const Flow = await runtime.model('flow')
    const FlowRun = await runtime.model('flowRun')
    const Ticket = await runtime.inbox.model('ticket')
    const flow = await Flow.findOrFail(flowId)
    const versionId = flow.publishedVersionId

    if (versionId === null) return { outcome: 'rejected', reason: 'not_published' }

    const botId = await runtime.botId()

    for (let attempt = 0; attempt < ATTEMPTS; attempt++) {
      const ticket = (await Ticket.findOrFail(ticketId)).snapshot

      if (ticket.state.status === 'closed') return { outcome: 'rejected', reason: 'closed' }

      const held = holder(ticket.state)?.id === botId
      const live = await runtime.live(ticketId)
      const now = DateTime.now()
      let created: InstanceType<typeof FlowRun>

      try {
        created = await runtime.db.transaction(async trx => {
          const reason = live?.status === 'running' && !held ? 'taken_over' : 'replaced'

          if (live !== null && !(await runtime.endRun(live, reason, null, now, trx))) {
            throw new Conflict()
          }

          return FlowRun.create(
            {
              ticketId,
              flowId,
              versionId,
              status: 'pending',
              liveTicketId: ticketId,
              revision: 0,
              vars: {},
              waiting: null,
              wakeAt: null,
              deadline: now.plus({ milliseconds: runtime.config.startDeadlineMs }),
              endedReason: null,
              endedDetail: null,
              bindingId: null,
              startedById: actor.kind === 'system' ? null : actor.id,
              endedAt: null,
            },
            { client: trx },
          )
        })
      } catch (error) {
        if (error instanceof Conflict || (await runtime.live(ticketId)) !== null) continue

        throw error
      }

      if (held) {
        await runtime.inbox.tickets.wake(ticketId, runtime.config.bot, startToken(created.id))
      } else {
        const result = await runtime.inbox.tickets.apply(
          ticketId,
          { gesture: 'assign', to: botId },
          actor,
        )

        if (result.outcome === 'rejected') {
          const pending = (await FlowRun.findOrFail(created.id)).asRun

          if (pending.status !== 'ended') {
            await runtime.endRun(pending, 'start_expired', `assign ${result.reason}`, now)
          }

          return { outcome: 'rejected', reason: result.reason }
        }
      }

      return { outcome: 'started', run: (await FlowRun.findOrFail(created.id)).asRun }
    }

    return { outcome: 'rejected', reason: 'conflict' }
  }

  /**
   * Ends the ticket's live run `stopped`, then returns the ticket to its queue as `actor` when
   * the bot holds it. A binding never starts a run on that ticket again.
   */
  async stop(ticketId: TicketId, actor: Actor): Promise<StopResult> {
    const runtime = this.#runtime
    const FlowRun = await runtime.model('flowRun')

    for (let attempt = 0; attempt < ATTEMPTS; attempt++) {
      const live = await runtime.live(ticketId)

      if (live === null) return { outcome: 'not_running' }

      if (!(await runtime.endRun(live, 'stopped', null, DateTime.now()))) continue

      const Ticket = await runtime.inbox.model('ticket')
      const ticket = (await Ticket.findOrFail(ticketId)).snapshot

      if (holder(ticket.state)?.id === (await runtime.botId())) {
        await runtime.inbox.tickets.apply(ticketId, { gesture: 'return' }, actor)
      }

      return { outcome: 'stopped', run: (await FlowRun.findOrFail(live.id)).asRun }
    }

    return { outcome: 'not_running' }
  }

  readonly runs = {
    /**
     * Every run the ticket had, oldest first.
     */
    forTicket: async (ticketId: TicketId): Promise<FlowRun[]> => {
      const FlowRun = await this.#runtime.model('flowRun')
      const rows = await FlowRun.query().where('ticketId', ticketId).orderBy('id')

      return rows.map(row => row.asRun)
    },
  }

  /**
   * Ends the ticket's live run when the ticket left the bot, closed, or a manual start's assign
   * never landed, deciding from the rows as they are now. Run on every ticket change, so a late
   * or repeated call does nothing. Returns the reason it ended the run with.
   */
  async reconcile(ticketId: TicketId, now = DateTime.now()): Promise<RunEndReason | null> {
    const runtime = this.#runtime
    const live = await runtime.live(ticketId)

    if (live === null) return null

    const Ticket = await runtime.inbox.model('ticket')
    const ticket = (await Ticket.findOrFail(ticketId)).snapshot
    const reason = lostReason(live, ticket, await runtime.botId(), now)

    if (reason === null || !(await runtime.endRun(live, reason, null, now))) return null

    return reason
  }

  /**
   * `node ace flows:tick`. Each part converges, so a second tick only repeats no-ops:
   *
   * - ends live runs whose ticket is no longer the bot's, or whose manual start expired;
   * - wakes again the runs whose wait is due, and the manual starts the bot holds but never
   *   entered, in case the wake was lost, such as by a restart under `tasks.inline()`. The wake's
   *   token makes a duplicate a no-op;
   * - delivers the `after_commit` effects that are due, or whose delivery died mid-call.
   */
  async tick(now = DateTime.now()): Promise<FlowsTickReport> {
    const runtime = this.#runtime
    const FlowRun = await runtime.model('flowRun')
    const FlowEffect = await runtime.model('flowEffect')
    const Ticket = await runtime.inbox.model('ticket')
    const botId = await runtime.botId()

    const report: FlowsTickReport = {
      ended: {},
      woken: 0,
      effects: { delivered: 0, retried: 0, failed: 0 },
    }

    // A pending run before its deadline is a start whose assign hasn't landed, so it can't be lost.
    const lost = await FlowRun.query()
      .whereNotNull('liveTicketId')
      .where(over =>
        over.where('status', 'running').orWhere('deadline', '<=', sqlTime(FlowRun, now)),
      )
      .whereIn(
        'ticketId',
        Ticket.query()
          .select('id')
          .where(open => open.whereNot('status', 'in_progress').orWhereNot('assigneeId', botId)),
      )
      .orderBy('id')
      .limit(TICK_BATCH)
      .select('ticketId')

    for (const { ticketId } of lost) {
      const reason = await this.reconcile(ticketId, now)

      if (reason !== null) report.ended[reason] = (report.ended[reason] ?? 0) + 1
    }

    // The sweep above ended the pending runs whose ticket isn't the bot's, so a pending run past
    // its deadline here is one the bot holds and whose start wake was lost.
    const due = await FlowRun.query()
      .where(waits =>
        waits
          .where(running =>
            running.where('status', 'running').where('wakeAt', '<=', sqlTime(FlowRun, now)),
          )
          .orWhere(pending =>
            pending.where('status', 'pending').where('deadline', '<=', sqlTime(FlowRun, now)),
          ),
      )
      .orderBy('id')
      .limit(TICK_BATCH)

    for (const row of due) {
      const run = row.asRun

      if (run.status === 'ended') continue

      await runtime.inbox.tickets.wake(
        run.ticketId,
        runtime.config.bot,
        run.status === 'pending' ? startToken(run.id) : wakeToken(run.id, run.wait.waiting.token),
      )
      report.woken++
    }

    const stranded = await FlowEffect.query()
      .where(claimable =>
        claimable
          .where(pending =>
            pending
              .where('status', 'pending')
              .where('nextAttemptAt', '<=', sqlTime(FlowEffect, now)),
          )
          .orWhere(abandoned =>
            abandoned
              .where('status', 'delivering')
              .where('leaseUntil', '<', sqlTime(FlowEffect, now)),
          ),
      )
      .orderBy('id')
      .limit(TICK_BATCH)
      .select('id')

    for (const { id } of stranded) {
      const outcome = await runtime.deliver(id, now)

      if (outcome !== 'skipped') report.effects[outcome]++
    }

    return report
  }

  /**
   * Fields whose widget names a queue, an attendant or a close reason must name one that
   * exists, then the node checks, then the host's rules.
   */
  async #publishProblems(flowId: FlowId, graph: FlowGraph): Promise<Problem[]> {
    const { nodes, closeReasons, validatePublish } = this.#runtime.config
    const problems = await nodes.check(graph, 'publish')

    if (problems.some(({ severity }) => severity === 'impediment')) return problems

    const entries = new Map(nodes.catalog.nodes.map(entry => [entry.type, entry]))

    const references: Array<{
      nodeId: string
      field: string
      kind: 'queue' | 'attendant' | 'close_reason'
      value: string
    }> = []

    for (const node of graph.nodes) {
      for (const [field, schema] of Object.entries(
        entries.get(node.type)?.schema.properties ?? {},
      )) {
        const kind = schema['x-ui']?.widget
        const value = node.data[field]

        if (value === undefined || value === null || value === '') continue

        if (kind === 'queue' || kind === 'attendant' || kind === 'close_reason') {
          references.push({
            nodeId: node.id,
            field,
            kind,
            value: textOf(value) ?? JSON.stringify(value),
          })
        }
      }
    }

    const existing = async (kind: 'queue' | 'attendant') => {
      const ids = references.flatMap(reference =>
        reference.kind === kind && Number.isInteger(Number(reference.value))
          ? [Number(reference.value)]
          : [],
      )

      if (ids.length === 0) return new Set<string>()

      const Model = await this.#runtime.inbox.model(kind)
      const rows = await Model.query().whereIn('id', ids).select('id')

      return new Set(rows.map(({ id }) => String(id)))
    }

    const known = {
      queue: await existing('queue'),
      attendant: await existing('attendant'),
      close_reason: closeReasons,
    }

    for (const { nodeId, field, kind, value } of references) {
      if (!known[kind].has(value)) {
        problems.push({
          code: 'unknown_reference',
          severity: 'impediment',
          nodeId,
          field,
          detail: `no ${kind.replace('_', ' ')} "${value}"`,
        })
      }
    }

    return [...problems, ...(await validatePublish({ flowId, graph }))]
  }

  async #writeDraft(id: FlowId, graph: FlowGraph, revision: number): Promise<SaveDraftResult> {
    const Flow = await this.#runtime.model('flow')

    const updated = await Flow.query()
      .where('id', id)
      .where('draftRevision', revision)
      .update({
        draft: JSON.stringify(graph),
        draftRevision: revision + 1,
        updatedAt: sqlTime(Flow, DateTime.now()),
      })

    if (affectedRows(updated) === 0) {
      return { outcome: 'stale', flow: view(await Flow.findOrFail(id)) }
    }

    return {
      outcome: 'saved',
      revision: revision + 1,
      problems: await this.#runtime.config.nodes.check(graph, 'publish'),
    }
  }
}

function view(flow: InboxFlowRow): FlowView {
  return {
    id: flow.id,
    name: flow.name,
    draft: flow.draft,
    draftRevision: flow.draftRevision,
    publishedVersionId: flow.publishedVersionId,
  }
}

function versionView(version: {
  id: FlowVersionId
  flowId: FlowId
  number: number
  graph: FlowGraph
  hash: string
  publishedBy: string | null
  createdAt: DateTime
}): FlowVersionView {
  return {
    id: version.id,
    flowId: version.flowId,
    number: version.number,
    graph: version.graph,
    hash: version.hash,
    publishedBy: version.publishedBy,
    publishedAt: version.createdAt,
  }
}
