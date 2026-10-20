import { column } from '@adonisjs/lucid/orm'
import type { AttendantId, TicketId } from '@enzopita/adonisjs-inbox'
import type { DateTime } from 'luxon'

import { InboxFlowsError } from '../errors.ts'
import type { Variables } from '../graph/values.ts'
import { decodeWait, encodeWait, type FlowRun, type RunEndReason, type RunWait } from '../run.ts'
import type { FlowBindingId, FlowId, FlowRunId, FlowVersionId } from '../types.ts'
import { jsonText, type FlowsModel, type Model } from './model.ts'

/**
 * The columns of `inbox_flow_runs`. The row is the only record of a run: where it waits, what it
 * captured, the version it is pinned to and why it ended.
 */
export interface InboxFlowRunRow {
  id: FlowRunId
  ticketId: TicketId
  flowId: FlowId
  versionId: FlowVersionId
  status: FlowRun['status']
  /**
   * The ticket id while pending or running, null once ended. Its unique index keeps one live run
   * per ticket on every database, since NULLs never collide.
   */
  liveTicketId: TicketId | null
  revision: number
  vars: Variables
  waiting: RunWait | null
  /**
   * When the run's wait is due, copied from `waiting` for the tick's index.
   */
  wakeAt: DateTime | null
  deadline: DateTime | null
  endedReason: RunEndReason | null
  endedDetail: string | null
  bindingId: FlowBindingId | null
  startedById: AttendantId | null
  createdAt: DateTime
  endedAt: DateTime | null
  readonly asRun: FlowRun
}

export type InboxFlowRunModel<M extends Model = Model> = FlowsModel<'flowRun', InboxFlowRunRow, M>

export function withInboxFlowRun(): <M extends Model>(superclass: M) => InboxFlowRunModel<M> {
  const mixin = (superclass: Model) => {
    class InboxFlowRun extends superclass {
      static readonly inboxFlowsRole = 'flowRun'

      declare id: FlowRunId
      declare ticketId: TicketId
      declare flowId: FlowId
      declare versionId: FlowVersionId
      declare status: FlowRun['status']
      declare liveTicketId: TicketId | null
      declare revision: number
      declare wakeAt: DateTime | null
      declare deadline: DateTime | null
      declare endedReason: RunEndReason | null
      declare endedDetail: string | null
      declare bindingId: FlowBindingId | null
      declare startedById: AttendantId | null
      declare createdAt: DateTime
      declare endedAt: DateTime | null

      @column(jsonText<Variables>())
      declare vars: Variables

      @column({
        prepare: (value: RunWait | null) => (value === null ? null : encodeWait(value)),
        consume: (value: string | null) => (value === null ? null : decodeWait(value)),
      })
      declare waiting: RunWait | null

      get asRun() {
        return toRun(this)
      }
    }

    return InboxFlowRun
  }

  // SAFETY: InboxFlowRun parses vars and waiting, and the other columns only narrow M's types.
  return mixin as <M extends Model>(superclass: M) => InboxFlowRunModel<M>
}

function toRun(row: Omit<InboxFlowRunRow, 'asRun'>): FlowRun {
  const base = {
    id: row.id,
    ticketId: row.ticketId,
    flowId: row.flowId,
    versionId: row.versionId,
    revision: row.revision,
    bindingId: row.bindingId,
    startedById: row.startedById,
    vars: row.vars,
    createdAt: row.createdAt,
  }

  switch (row.status) {
    case 'pending':
      if (row.deadline !== null) return { ...base, status: 'pending', deadline: row.deadline }

      break
    case 'running':
      if (row.waiting !== null) return { ...base, status: 'running', wait: row.waiting }

      break
    case 'ended':
      if (row.endedReason !== null && row.endedAt !== null) {
        return {
          ...base,
          status: 'ended',
          reason: row.endedReason,
          detail: row.endedDetail,
          endedAt: row.endedAt,
        }
      }

      break
    default: {
      const unknownStatus: never = row.status

      return unknownStatus
    }
  }

  throw new InboxFlowsError(
    'E_INBOX_FLOWS_INVALID_ROW',
    `inbox-flows: run ${row.id} is ${row.status} without the columns that status needs, which the migration's CHECK constraints forbid`,
  )
}
