import { column } from '@adonisjs/lucid/orm'
import type { ChannelId, QueueId } from '@enzopita/adonisjs-inbox'

import type { Binding, BindingCondition } from '../bindings.ts'
import type { FlowBindingId, FlowId } from '../types.ts'
import { nullableJsonText, type FlowsModel, type Model } from './model.ts'

export interface InboxFlowBindingRow {
  id: FlowBindingId
  flowId: FlowId
  priority: number
  channelId: ChannelId | null
  queueId: QueueId | null
  condition: BindingCondition | null
  readonly asBinding: Binding
}

export type InboxFlowBindingModel<M extends Model = Model> = FlowsModel<
  'flowBinding',
  InboxFlowBindingRow,
  M
>

export function withInboxFlowBinding(): <M extends Model>(
  superclass: M,
) => InboxFlowBindingModel<M> {
  const mixin = (superclass: Model) => {
    class InboxFlowBinding extends superclass {
      static readonly inboxFlowsRole = 'flowBinding'

      declare id: FlowBindingId
      declare flowId: FlowId
      declare priority: number
      declare channelId: ChannelId | null
      declare queueId: QueueId | null

      @column(nullableJsonText<BindingCondition>())
      declare condition: BindingCondition | null

      get asBinding(): Binding {
        return {
          id: this.id,
          flowId: this.flowId,
          priority: this.priority,
          channelId: this.channelId,
          queueId: this.queueId,
          condition: this.condition,
        }
      }
    }

    return InboxFlowBinding
  }

  // SAFETY: InboxFlowBinding parses condition, and the other columns only narrow M's types.
  return mixin as <M extends Model>(superclass: M) => InboxFlowBindingModel<M>
}
