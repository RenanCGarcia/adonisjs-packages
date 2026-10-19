import type { DateTime } from 'luxon'

import type { ChannelEventId, ChannelId } from '../types.ts'
import type { InboxModel, Model } from './model.ts'

export interface InboxChannelEventRow {
  id: ChannelEventId
  channelId: ChannelId
  rawBody: string
  receivedAt: DateTime
  claimedAt: DateTime | null
  processedAt: DateTime | null
}

export type InboxChannelEventModel<M extends Model = Model> = InboxModel<
  'channelEvent',
  InboxChannelEventRow,
  M
>

export function withInboxChannelEvent(): <M extends Model>(
  superclass: M,
) => InboxChannelEventModel<M> {
  const mixin = (superclass: Model) => {
    class InboxChannelEvent extends superclass {
      static readonly inboxRole = 'channelEvent'

      declare id: ChannelEventId
      declare channelId: ChannelId
      declare rawBody: string
      declare receivedAt: DateTime
      declare claimedAt: DateTime | null
      declare processedAt: DateTime | null
    }

    return InboxChannelEvent
  }

  // SAFETY: InboxChannelEvent only narrows the types of columns M already has at runtime.
  return mixin as <M extends Model>(superclass: M) => InboxChannelEventModel<M>
}
