import { column } from '@adonisjs/lucid/orm'
import type { DateTime } from 'luxon'

import type { ChannelStatus } from '../adapters/port.ts'
import type { ChannelId, JsonValue, QueueId } from '../types.ts'
import { jsonText, type InboxModel, type Model } from './model.ts'

export interface InboxChannelRow {
  id: ChannelId
  provider: string
  name: string
  defaultQueueId: QueueId
  webhookToken: string
  status: ChannelStatus
  credentials: JsonValue
  archivedAt: DateTime | null
}

export type InboxChannelModel<M extends Model = Model> = InboxModel<'channel', InboxChannelRow, M>

export function withInboxChannel(): <M extends Model>(superclass: M) => InboxChannelModel<M> {
  const mixin = (superclass: Model) => {
    class InboxChannel extends superclass {
      static readonly inboxRole = 'channel'

      declare id: ChannelId
      declare provider: string
      declare name: string
      declare defaultQueueId: QueueId
      declare webhookToken: string
      declare status: ChannelStatus
      declare archivedAt: DateTime | null

      @column(jsonText<JsonValue>())
      declare credentials: JsonValue
    }

    return InboxChannel
  }

  // SAFETY: InboxChannel parses credentials, and the other columns only narrow M's types.
  return mixin as <M extends Model>(superclass: M) => InboxChannelModel<M>
}
