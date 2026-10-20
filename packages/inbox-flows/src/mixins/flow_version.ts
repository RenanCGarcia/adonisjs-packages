import { column } from '@adonisjs/lucid/orm'
import type { DateTime } from 'luxon'

import type { FlowGraph } from '../graph/types.ts'
import type { FlowId, FlowVersionId } from '../types.ts'
import { jsonText, type FlowsModel, type Model } from './model.ts'

/**
 * Immutable: the package inserts versions and never updates or deletes one, so a run pinned to a
 * version always finds it as it started.
 */
export interface InboxFlowVersionRow {
  id: FlowVersionId
  flowId: FlowId
  /**
   * 1, 2, 3... per flow.
   */
  number: number
  graph: FlowGraph
  /**
   * `graphHash(graph)`, which ignores layout.
   */
  hash: string
  publishedBy: string | null
  createdAt: DateTime
}

export type InboxFlowVersionModel<M extends Model = Model> = FlowsModel<
  'flowVersion',
  InboxFlowVersionRow,
  M
>

export function withInboxFlowVersion(): <M extends Model>(
  superclass: M,
) => InboxFlowVersionModel<M> {
  const mixin = (superclass: Model) => {
    class InboxFlowVersion extends superclass {
      static readonly inboxFlowsRole = 'flowVersion'

      declare id: FlowVersionId
      declare flowId: FlowId
      declare number: number
      declare hash: string
      declare publishedBy: string | null
      declare createdAt: DateTime

      @column(jsonText<FlowGraph>())
      declare graph: FlowGraph
    }

    return InboxFlowVersion
  }

  // SAFETY: InboxFlowVersion parses graph, and the other columns only narrow M's types.
  return mixin as <M extends Model>(superclass: M) => InboxFlowVersionModel<M>
}
