import type { ApplicationService, ContainerBindings, LoggerService } from '@adonisjs/core/types'
import type { Database } from '@adonisjs/lucid/database'
import type { QueryClientContract } from '@adonisjs/lucid/types/database'
import vine from '@vinejs/vine'
import type { AttendantId, JsonValue, TicketId } from '@enzopita/adonisjs-inbox'
import type {} from '@enzopita/adonisjs-inbox/inbox_provider'
import { DateTime } from 'luxon'

import type { Binding } from './bindings.ts'
import type { AfterCommitEffect, CompileResult, InTransactionEffect } from './define.ts'
import type { ResolvedFlowsConfig } from './define_config.ts'
import { InboxFlowsError } from './errors.ts'
import type { JsonObject } from './graph/types.ts'
import type { FlowsModelRole } from './models.ts'
import { HUMAN_OWNED, type LiveRun, type RunEndReason } from './run.ts'
import { affectedRows, sqlTime } from './sql.ts'
import type { FlowEffectId, FlowVersionId } from './types.ts'

type Inbox = ContainerBindings['inbox']

/**
 * An `after_commit` effect is attempted this many times, its delays doubling up to the cap. A
 * delivery owns its row for the lease, so a worker that dies mid-call loses it after that.
 */
export const EFFECT_POLICY = {
  attempts: 5,
  firstDelayMs: 2000,
  maxDelayMs: 60_000,
  leaseMs: 120_000,
} as const

export interface CompiledVersion {
  number: number
  result: CompileResult
}

type Validate = (payload: JsonValue) => Promise<JsonObject>

type ResolvedEffect =
  | { delivery: 'in_transaction'; handler: InTransactionEffect<JsonObject>; validate: Validate }
  | { delivery: 'after_commit'; handler: AfterCommitEffect<JsonObject>; validate: Validate }

export type DeliveryOutcome = 'delivered' | 'retried' | 'failed' | 'skipped'

/**
 * What the bot, the service and the tick share: the config, the inbox, and the reads and writes
 * of runs and effects that more than one of them makes.
 */
export class FlowsRuntime {
  readonly config: ResolvedFlowsConfig
  readonly inbox: Inbox
  readonly db: Database
  readonly logger: LoggerService
  readonly #container: ApplicationService['container']
  readonly #compiled = new Map<FlowVersionId, Promise<CompiledVersion>>()
  readonly #effects = new Map<string, Promise<ResolvedEffect>>()
  #botId: Promise<AttendantId> | undefined

  constructor(
    config: ResolvedFlowsConfig,
    inbox: Inbox,
    db: Database,
    container: ApplicationService['container'],
    logger: LoggerService,
  ) {
    this.config = config
    this.inbox = inbox
    this.db = db
    this.#container = container
    this.logger = logger
  }

  model<R extends FlowsModelRole>(role: R) {
    return this.config.model(role)
  }

  /**
   * The flows bot's attendant id, created on first use.
   */
  botId() {
    this.#botId ??= this.inbox.attendants
      .bot(this.config.bot)
      .then(attendant => attendant.id)
      .catch(error => {
        this.#botId = undefined
        throw error
      })

    return this.#botId
  }

  async live(ticketId: TicketId, client?: QueryClientContract): Promise<LiveRun | null> {
    const FlowRun = await this.model('flowRun')
    const row = await FlowRun.query({ client }).where('liveTicketId', ticketId).first()
    const run = row?.asRun ?? null

    return run === null || run.status === 'ended' ? null : run
  }

  /**
   * Whether a person owns the ticket since an earlier run, so no binding may start one.
   */
  async vetoed(ticketId: TicketId) {
    const FlowRun = await this.model('flowRun')

    const ended = await FlowRun.query()
      .where('ticketId', ticketId)
      .whereIn('endedReason', HUMAN_OWNED)
      .first()

    return ended !== null
  }

  /**
   * Every binding of a flow that has a published version, with that version.
   */
  async bindings(): Promise<Array<Binding & { versionId: FlowVersionId }>> {
    const FlowBinding = await this.model('flowBinding')
    const Flow = await this.model('flow')
    const rows = await FlowBinding.query()

    if (rows.length === 0) return []

    const flows = await Flow.query()
      .whereIn(
        'id',
        rows.map(row => row.flowId),
      )
      .whereNotNull('publishedVersionId')

    const published = new Map(flows.map(flow => [flow.id, flow.publishedVersionId]))

    return rows.flatMap(row => {
      const versionId = published.get(row.flowId)

      return versionId === undefined || versionId === null ? [] : [{ ...row.asBinding, versionId }]
    })
  }

  /**
   * Versions never change, so each compiles once per process.
   */
  compiled(versionId: FlowVersionId) {
    let compiled = this.#compiled.get(versionId)

    if (compiled === undefined) {
      compiled = (async () => {
        const FlowVersion = await this.model('flowVersion')
        const version = await FlowVersion.findOrFail(versionId)

        return { number: version.number, result: await this.config.nodes.compile(version.graph) }
      })()

      compiled.catch(() => this.#compiled.delete(versionId))
      this.#compiled.set(versionId, compiled)
    }

    return compiled
  }

  /**
   * Ends exactly the revision of `run` that was read. `false` when another writer moved it first.
   */
  async endRun(
    run: LiveRun,
    reason: RunEndReason,
    detail: string | null,
    now: DateTime,
    client?: QueryClientContract,
  ) {
    const FlowRun = await this.model('flowRun')

    const updated = await FlowRun.query({ client })
      .where('id', run.id)
      .where('revision', run.revision)
      .update({
        status: 'ended',
        liveTicketId: null,
        revision: run.revision + 1,
        waiting: null,
        wakeAt: null,
        deadline: null,
        endedReason: reason,
        endedDetail: detail,
        endedAt: sqlTime(FlowRun, now),
        updatedAt: sqlTime(FlowRun, now),
      })

    return affectedRows(updated) > 0
  }

  /**
   * The handler of a node type's effect, made through the container once.
   */
  effect(type: string) {
    let resolved = this.#effects.get(type)

    if (resolved === undefined) {
      resolved = this.#resolveEffect(type)
      resolved.catch(() => this.#effects.delete(type))
      this.#effects.set(type, resolved)
    }

    return resolved
  }

  async #resolveEffect(type: string): Promise<ResolvedEffect> {
    const definition = this.config.nodes.effects.get(type)

    if (definition === undefined) {
      throw new InboxFlowsError(
        'E_INBOX_FLOWS_INVALID_CONFIG',
        `inbox-flows: no node type "${type}" in config.nodes declares an effect`,
      )
    }

    const validator = vine.create(definition.payload)
    const validate: Validate = payload => validator.validate(payload)

    switch (definition.delivery) {
      case 'in_transaction': {
        const { default: Handler } = await definition.handler()

        return {
          delivery: 'in_transaction',
          handler: await this.#container.make(Handler),
          validate,
        }
      }

      case 'after_commit': {
        const { default: Handler } = await definition.handler()

        return { delivery: 'after_commit', handler: await this.#container.make(Handler), validate }
      }
    }
  }

  /**
   * One attempt at an outbox row, claimed by a conditional update so two deliveries never call
   * its handler at once. The call runs outside any transaction. A failure schedules the next
   * attempt, and the last one marks the row failed.
   */
  async deliver(id: FlowEffectId, now: DateTime): Promise<DeliveryOutcome> {
    const FlowEffect = await this.model('flowEffect')
    const row = await FlowEffect.find(id)

    if (row === null) return 'skipped'

    const due =
      (row.status === 'pending' && row.nextAttemptAt !== null && row.nextAttemptAt <= now) ||
      (row.status === 'delivering' && row.leaseUntil !== null && row.leaseUntil < now)

    if (!due) return 'skipped'

    // Only a delivery that died mid-call gets here with no attempt left, and it used the last one.
    if (row.attempts >= EFFECT_POLICY.attempts) {
      const gaveUp = await FlowEffect.query()
        .where('id', id)
        .where('status', row.status)
        .where('attempts', row.attempts)
        .update({
          status: 'failed',
          leaseUntil: null,
          nextAttemptAt: null,
          settledAt: sqlTime(FlowEffect, now),
          updatedAt: sqlTime(FlowEffect, now),
        })

      return affectedRows(gaveUp) > 0 ? 'failed' : 'skipped'
    }

    const attempt = row.attempts + 1

    const claimed = await FlowEffect.query()
      .where('id', id)
      .where('status', row.status)
      .where('attempts', row.attempts)
      .update({
        status: 'delivering',
        attempts: attempt,
        leaseUntil: sqlTime(FlowEffect, now.plus({ milliseconds: EFFECT_POLICY.leaseMs })),
        nextAttemptAt: null,
        updatedAt: sqlTime(FlowEffect, now),
      })

    if (affectedRows(claimed) === 0) return 'skipped'

    const settle = async (outcome: Exclude<DeliveryOutcome, 'skipped'>, error: string | null) => {
      const delayMs = Math.min(
        EFFECT_POLICY.maxDelayMs,
        EFFECT_POLICY.firstDelayMs * 2 ** (attempt - 1),
      )

      await FlowEffect.query()
        .where('id', id)
        .where('status', 'delivering')
        .where('attempts', attempt)
        .update({
          status: outcome === 'delivered' ? 'done' : outcome === 'failed' ? 'failed' : 'pending',
          leaseUntil: null,
          nextAttemptAt:
            outcome === 'retried' ? sqlTime(FlowEffect, now.plus({ milliseconds: delayMs })) : null,
          lastError: error,
          settledAt: outcome === 'retried' ? null : sqlTime(FlowEffect, now),
          updatedAt: sqlTime(FlowEffect, now),
        })

      return outcome
    }

    let effect: ResolvedEffect
    let payload: JsonObject

    try {
      effect = await this.effect(row.type)
      payload = await effect.validate(row.payload)
    } catch (error) {
      this.logger.error({ err: error, effectId: id }, 'inbox-flows: an effect can not be delivered')

      return settle('failed', String(error))
    }

    if (effect.delivery !== 'after_commit') return settle('failed', 'not an after_commit effect')

    const FlowRun = await this.model('flowRun')
    const run = await FlowRun.findOrFail(row.runId)

    try {
      await effect.handler.deliver(payload, {
        ticketId: row.ticketId,
        run: { id: run.id, flowId: run.flowId, versionId: run.versionId },
        node: row.nodeId,
        idempotencyKey: row.idempotencyKey,
        attempt,
      })
    } catch (error) {
      const last = attempt >= EFFECT_POLICY.attempts

      this.logger.warn(
        { err: error, effectId: id, attempt },
        last
          ? 'inbox-flows: an effect failed on its last attempt'
          : 'inbox-flows: an effect failed',
      )

      return settle(last ? 'failed' : 'retried', String(error))
    }

    return settle('delivered', null)
  }

  /**
   * Deliveries after a commit already committed, so a failure is logged instead of reaching the
   * inbox, which would skip the work queued after it.
   */
  async deliverAll(ids: FlowEffectId[]) {
    for (const id of ids) {
      try {
        await this.deliver(id, DateTime.now())
      } catch (error) {
        this.logger.error({ err: error, effectId: id }, 'inbox-flows: an effect delivery failed')
      }
    }
  }
}
