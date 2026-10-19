import type { AttendantId, QueueId } from '../types.ts'
import type { InboxModel, Model } from './model.ts'

export interface InboxQueueMemberRow {
  queueId: QueueId
  attendantId: AttendantId
}

export type InboxQueueMemberModel<M extends Model = Model> = InboxModel<
  'queueMember',
  InboxQueueMemberRow,
  M
>

export function withInboxQueueMember(): <M extends Model>(
  superclass: M,
) => InboxQueueMemberModel<M> {
  const mixin = (superclass: Model) => {
    class InboxQueueMember extends superclass {
      static readonly inboxRole = 'queueMember'

      declare queueId: QueueId
      declare attendantId: AttendantId
    }

    return InboxQueueMember
  }

  // SAFETY: InboxQueueMember only narrows the types of columns M already has at runtime.
  return mixin as <M extends Model>(superclass: M) => InboxQueueMemberModel<M>
}
