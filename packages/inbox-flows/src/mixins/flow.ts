import { column } from '@adonisjs/lucid/orm'

import type { FlowGraph } from '../graph/types.ts'
import type { FlowId, FlowVersionId } from '../types.ts'
import { jsonText, type FlowsModel, type Model } from './model.ts'

export interface InboxFlowRow {
  id: FlowId
  name: string
  /**
   * What the editor saves. Running tickets never read it: they run a published version.
   */
  draft: FlowGraph
  /**
   * Bumped by every save, which compares it, so two editors never overwrite each other.
   */
  draftRevision: number
  publishedVersionId: FlowVersionId | null
}

export type InboxFlowModel<M extends Model = Model> = FlowsModel<'flow', InboxFlowRow, M>

export function withInboxFlow(): <M extends Model>(superclass: M) => InboxFlowModel<M> {
  const mixin = (superclass: Model) => {
    class InboxFlow extends superclass {
      static readonly inboxFlowsRole = 'flow'

      declare id: FlowId
      declare name: string
      declare draftRevision: number
      declare publishedVersionId: FlowVersionId | null

      @column(jsonText<FlowGraph>())
      declare draft: FlowGraph
    }

    return InboxFlow
  }

  // SAFETY: InboxFlow parses draft, and the other columns only narrow M's types.
  return mixin as <M extends Model>(superclass: M) => InboxFlowModel<M>
}
