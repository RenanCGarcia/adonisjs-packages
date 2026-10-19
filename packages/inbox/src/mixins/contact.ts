import type { ChannelId, ContactId } from '../types.ts'
import type { InboxModel, Model } from './model.ts'

export interface InboxContactRow {
  id: ContactId
  channelId: ChannelId
  address: string
  name: string | null
}

export type InboxContactModel<M extends Model = Model> = InboxModel<'contact', InboxContactRow, M>

export function withInboxContact(): <M extends Model>(superclass: M) => InboxContactModel<M> {
  const mixin = (superclass: Model) => {
    class InboxContact extends superclass {
      static readonly inboxRole = 'contact'

      declare id: ContactId
      declare channelId: ChannelId
      declare address: string
      declare name: string | null
    }

    return InboxContact
  }

  // SAFETY: InboxContact only narrows the types of columns M already has at runtime.
  return mixin as <M extends Model>(superclass: M) => InboxContactModel<M>
}
