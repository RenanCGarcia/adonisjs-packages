import { randomUUID } from 'node:crypto'

import type {
  Bot,
  BotHandoff,
  BotReply,
  BotTurn,
  BotWithin,
  MessageContent,
  TicketSnapshot,
} from '@enzopita/adonisjs-inbox'
import { DateTime } from 'luxon'

import { matchBinding } from './bindings.ts'
import {
  runTurn,
  type EmittedEffect,
  type EndReason,
  type Outcome,
  type RunState,
  type Trigger,
} from './interpreter.ts'
import {
  decideTurn,
  encodeWait,
  wakeToken,
  type LiveRun,
  type PendingRun,
  type RunningRun,
  type TurnTrigger,
} from './run.ts'
import type { CompiledVersion, FlowsRuntime } from './runtime.ts'
import { affectedRows, sqlTime } from './sql.ts'
import type { FlowBindingId, FlowEffectId, FlowId, FlowRunId, FlowVersionId } from './types.ts'

const SILENT: BotReply<null> = { kind: 'silent', state: null }

/**
 * Endings that are the flow's own decision. A turn that ends any other way, `failed` or
 * `step_budget_exhausted`, keeps what it said and drops its effects: a broken or looping graph
 * would otherwise repeat them or leave them half done.
 */
const KEEPS_EFFECTS: ReadonlySet<EndReason> = new Set(['completed', 'handed_off', 'closed'])

type Advanced = Exclude<Outcome, { kind: 'idle' }>

/**
 * The run row the turn writes: a new one from a binding, or the live one it read.
 */
type Target =
  | { kind: 'insert'; flowId: FlowId; versionId: FlowVersionId; bindingId: FlowBindingId }
  | { kind: 'update'; run: LiveRun }

interface Turn {
  target: Target
  /**
   * A run the bot lost track of, ended `taken_over` in the same commit.
   */
  supersede: RunningRun | null
  outcome: Advanced
  version: number
}

/**
 * The bot of every flow, registered by the host in `config.bots`. Everything before `within` is
 * a read, so the inbox may run a turn as often as it needs. The replies, the handoff, the run
 * row and the effects commit in one transaction, guarded by the ticket's version and the run's
 * revision, so they land together exactly once or not at all.
 */
export default class FlowsBot implements Bot<null> {
  readonly #runtime: FlowsRuntime

  constructor(runtime: FlowsRuntime) {
    this.#runtime = runtime
  }

  get debounce() {
    return this.#runtime.config.debounce
  }

  /**
   * The run row is the state, so `botState` stays `null`.
   */
  initialState(): null {
    return null
  }

  async turn(turn: BotTurn<null>): Promise<BotReply<null>> {
    const trigger: TurnTrigger =
      turn.trigger === 'wake' ? { kind: 'wake', token: turn.token } : { kind: turn.trigger }

    const plan = decideTurn(trigger, await this.#runtime.live(turn.ticket.id))

    switch (plan.kind) {
      case 'idle':
        return SILENT
      case 'select':
        return this.#select(turn, plan.supersede)
      case 'enter':
        return this.#enter(turn, plan.run)
      case 'resume':
        return this.#resume(turn, plan.run, plan.trigger)
    }
  }

  async #select(turn: BotTurn<null>, supersede: RunningRun | null) {
    const vetoed = supersede !== null || (await this.#runtime.vetoed(turn.ticket.id))

    const binding = vetoed
      ? null
      : matchBinding(await this.#runtime.bindings(), {
          channelId: turn.channel.id,
          queueId: turn.ticket.state.queueId,
          message: turn.unanswered.map(({ content }) => content.text).join('\n'),
        })

    if (binding === null) return this.#decline(turn, supersede)

    const version = await this.#runtime.compiled(binding.versionId)

    return this.#reply(turn, {
      target: {
        kind: 'insert',
        flowId: binding.flowId,
        versionId: binding.versionId,
        bindingId: binding.id,
      },
      supersede,
      outcome: this.#start(version, turn),
      version: version.number,
    })
  }

  async #enter(turn: BotTurn<null>, run: PendingRun) {
    const version = await this.#runtime.compiled(run.versionId)

    return this.#reply(turn, {
      target: { kind: 'update', run },
      supersede: null,
      outcome: this.#start(version, turn),
      version: version.number,
    })
  }

  async #resume(turn: BotTurn<null>, run: RunningRun, trigger: Trigger) {
    const version = await this.#runtime.compiled(run.versionId)
    const state: RunState = { status: 'waiting', vars: run.vars, ...run.wait }

    const outcome =
      version.result.kind === 'compiled'
        ? runTurn(
            version.result.graph,
            state,
            { trigger, unanswered: turn.unanswered, now: turn.now },
            this.#runtime.config.maxSteps,
          )
        : broken(version, run.vars)

    if (outcome.kind === 'idle') return SILENT

    return this.#reply(turn, {
      target: { kind: 'update', run },
      supersede: null,
      outcome,
      version: version.number,
    })
  }

  /**
   * Runs the version's start node on a new run.
   */
  #start(version: CompiledVersion, turn: BotTurn<null>): Advanced {
    if (version.result.kind === 'invalid') return broken(version, {})

    const outcome = runTurn(
      version.result.graph,
      { status: 'fresh', vars: {} },
      { trigger: { kind: 'assigned' }, unanswered: turn.unanswered, now: turn.now },
      this.#runtime.config.maxSteps,
    )

    if (outcome.kind === 'idle') throw new Error('inbox-flows: a fresh run idled on its start')

    return outcome
  }

  /**
   * The bot holds a ticket no flow wants, so it gives the ticket back.
   */
  #decline(turn: BotTurn<null>, supersede: RunningRun | null): BotReply<null> {
    const within: BotWithin | undefined =
      supersede === null
        ? undefined
        : async trx =>
            (await this.#runtime.endRun(supersede, 'taken_over', null, turn.now, trx))
              ? 'ok'
              : 'stale'

    return {
      kind: 'reply',
      messages: [],
      state: null,
      handoff: { gesture: 'return', note: 'flows: no flow for this ticket' },
      within,
    }
  }

  #reply(turn: BotTurn<null>, planned: Turn): BotReply<null> {
    const { outcome } = planned

    const flowId =
      planned.target.kind === 'insert' ? planned.target.flowId : planned.target.run.flowId

    const handoff: BotHandoff | undefined =
      outcome.kind === 'end'
        ? {
            ...outcome.handoff,
            note: `flow ${flowId} v${planned.version}: ${outcome.reason}${outcome.detail === null ? '' : ` (${outcome.detail})`}`,
          }
        : undefined

    return {
      kind: 'reply',
      messages: outcome.say,
      state: null,
      handoff,
      within: (trx, ticket, later) => this.#commit(trx, ticket, later, planned, turn.now),
    }
  }

  async #commit(
    trx: Parameters<BotWithin>[0],
    ticket: TicketSnapshot,
    later: Parameters<BotWithin>[2],
    planned: Turn,
    now: DateTime,
  ): Promise<'ok' | 'stale'> {
    const runtime = this.#runtime
    const { outcome, supersede, target } = planned

    if (supersede !== null && !(await runtime.endRun(supersede, 'taken_over', null, now, trx))) {
      return 'stale'
    }

    const runId = await this.#writeRun(trx, ticket, target, outcome, now)

    if (runId === null) return 'stale'

    const run = {
      id: runId,
      flowId: target.kind === 'insert' ? target.flowId : target.run.flowId,
      versionId: target.kind === 'insert' ? target.versionId : target.run.versionId,
    }

    const kept = outcome.kind === 'wait' || KEEPS_EFFECTS.has(outcome.reason) ? outcome.effects : []
    const outbox: FlowEffectId[] = []

    for (const effect of kept) {
      const id = await this.#perform(trx, ticket, run, effect, now)

      if (id !== null) outbox.push(id)
    }

    later(async () => {
      await runtime.deliverAll(outbox)

      if (outcome.kind !== 'wait' || outcome.wake === null) return

      try {
        await runtime.inbox.tickets.wake(
          ticket.id,
          runtime.config.bot,
          wakeToken(runId, outcome.wake.token),
          { in: { milliseconds: Math.max(0, outcome.wake.at.diff(now).toMillis()) } },
        )
      } catch (error) {
        runtime.logger.error(
          { err: error, runId },
          'inbox-flows: a wake failed to schedule, so flows:tick sends it',
        )
      }
    })

    return 'ok'
  }

  /**
   * Applies an `in_transaction` effect with the turn's transaction, or stores an `after_commit`
   * one in the outbox and returns its id.
   */
  async #perform(
    trx: Parameters<BotWithin>[0],
    ticket: TicketSnapshot,
    run: { id: FlowRunId; flowId: FlowId; versionId: FlowVersionId },
    effect: EmittedEffect,
    now: DateTime,
  ) {
    const resolved = await this.#runtime.effect(effect.type)
    const payload = await resolved.validate(effect.payload)

    if (resolved.delivery === 'in_transaction') {
      await resolved.handler.apply(trx, payload, {
        ticketId: ticket.id,
        ticket,
        run,
        node: effect.node,
      })

      return null
    }

    const FlowEffect = await this.#runtime.model('flowEffect')

    const row = await FlowEffect.create(
      {
        runId: run.id,
        ticketId: ticket.id,
        nodeId: effect.node,
        type: effect.type,
        payload,
        idempotencyKey: randomUUID(),
        status: 'pending',
        attempts: 0,
        nextAttemptAt: now,
      },
      { client: trx },
    )

    return row.id
  }

  /**
   * Inserts the run a binding starts, guarded by the unique live ticket id, or moves the live
   * run from the revision the turn read. `null` when that revision moved.
   */
  async #writeRun(
    trx: Parameters<BotWithin>[0],
    ticket: TicketSnapshot,
    target: Target,
    outcome: Advanced,
    now: DateTime,
  ): Promise<FlowRunId | null> {
    const FlowRun = await this.#runtime.model('flowRun')

    const columns =
      outcome.kind === 'wait'
        ? {
            status: 'running' as const,
            liveTicketId: ticket.id,
            vars: outcome.state.vars,
            waiting: {
              waiting: outcome.state.waiting,
              seen: outcome.state.seen,
              waits: outcome.state.waits,
            },
            wakeAt: outcome.wake?.at ?? null,
            endedReason: null,
            endedDetail: null,
            endedAt: null,
          }
        : {
            status: 'ended' as const,
            liveTicketId: null,
            vars: outcome.state.vars,
            waiting: null,
            wakeAt: null,
            endedReason: outcome.reason,
            endedDetail: outcome.detail,
            endedAt: now,
          }

    if (target.kind === 'insert') {
      const row = await FlowRun.create(
        {
          ...columns,
          ticketId: ticket.id,
          flowId: target.flowId,
          versionId: target.versionId,
          bindingId: target.bindingId,
          startedById: null,
          revision: 0,
          deadline: null,
        },
        { client: trx },
      )

      return row.id
    }

    const { run } = target
    const time = (value: DateTime | null) => (value === null ? null : sqlTime(FlowRun, value))

    const updated = await FlowRun.query({ client: trx })
      .where('id', run.id)
      .where('revision', run.revision)
      .update({
        ...columns,
        revision: run.revision + 1,
        vars: JSON.stringify(columns.vars),
        waiting: columns.waiting === null ? null : encodeWait(columns.waiting),
        wakeAt: time(columns.wakeAt),
        deadline: null,
        endedAt: time(columns.endedAt),
        updatedAt: sqlTime(FlowRun, now),
      })

    return affectedRows(updated) > 0 ? run.id : null
  }
}

/**
 * A pinned version that no longer compiles, such as after its node type was removed, ends the
 * run and hands the ticket back instead of leaving it with the bot.
 */
function broken(version: CompiledVersion, vars: RunState['vars']): Advanced {
  const problems = version.result.kind === 'invalid' ? version.result.problems : []
  const codes = [...new Set(problems.map(({ code }) => code))].join(', ')

  const say: MessageContent[] = []

  return {
    kind: 'end',
    say,
    effects: [],
    state: { status: 'ended', vars, reason: 'failed' },
    reason: 'failed',
    handoff: { gesture: 'return' },
    detail: `version ${version.number} no longer compiles: ${codes}`,
  }
}
