import type { QueueId } from '../types.ts'
import type { InboxModel, Model } from './model.ts'

export interface InboxQueueRow {
  id: QueueId
  name: string
}

export type InboxQueueModel<M extends Model = Model> = InboxModel<'queue', InboxQueueRow, M>

export function withInboxQueue(): <M extends Model>(superclass: M) => InboxQueueModel<M> {
  const mixin = (superclass: Model) => {
    class InboxQueue extends superclass {
      static readonly inboxRole = 'queue'

      declare id: QueueId
      declare name: string
    }

    return InboxQueue
  }

  // SAFETY: InboxQueue only narrows the types of columns M already has at runtime.
  return mixin as <M extends Model>(superclass: M) => InboxQueueModel<M>
}
