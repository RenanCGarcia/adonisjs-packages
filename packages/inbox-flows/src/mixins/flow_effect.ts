import { column } from '@adonisjs/lucid/orm'
import type { JsonValue, TicketId } from '@enzopita/adonisjs-inbox'
import type { DateTime } from 'luxon'

import type { FlowEffectId, FlowRunId } from '../types.ts'
import { jsonText, type FlowsModel, type Model } from './model.ts'

/**
 * `pending` until a delivery claims it, `delivering` while one holds its lease, then `done`, or
 * `failed` after its last attempt.
 */
export type EffectStatus = 'pending' | 'delivering' | 'done' | 'failed'

/**
 * The outbox of `after_commit` effects. A row is inserted in the turn's transaction, so it
 * exists exactly when the turn committed.
 */
export interface InboxFlowEffectRow {
  id: FlowEffectId
  runId: FlowRunId
  ticketId: TicketId
  nodeId: string
  /**
   * The node type that emitted it, which names its handler.
   */
  type: string
  payload: JsonValue
  idempotencyKey: string
  status: EffectStatus
  attempts: number
  leaseUntil: DateTime | null
  nextAttemptAt: DateTime | null
  lastError: string | null
  settledAt: DateTime | null
}

export type InboxFlowEffectModel<M extends Model = Model> = FlowsModel<
  'flowEffect',
  InboxFlowEffectRow,
  M
>

export function withInboxFlowEffect(): <M extends Model>(superclass: M) => InboxFlowEffectModel<M> {
  const mixin = (superclass: Model) => {
    class InboxFlowEffect extends superclass {
      static readonly inboxFlowsRole = 'flowEffect'

      declare id: FlowEffectId
      declare runId: FlowRunId
      declare ticketId: TicketId
      declare nodeId: string
      declare type: string
      declare idempotencyKey: string
      declare status: EffectStatus
      declare attempts: number
      declare leaseUntil: DateTime | null
      declare nextAttemptAt: DateTime | null
      declare lastError: string | null
      declare settledAt: DateTime | null

      @column(jsonText<JsonValue>())
      declare payload: JsonValue
    }

    return InboxFlowEffect
  }

  // SAFETY: InboxFlowEffect parses payload, and the other columns only narrow M's types.
  return mixin as <M extends Model>(superclass: M) => InboxFlowEffectModel<M>
}
