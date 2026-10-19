import type { ChannelId, ContactId, ConversationId } from '../types.ts'
import type { InboxModel, Model } from './model.ts'

export interface InboxConversationRow {
  id: ConversationId
  channelId: ChannelId
  contactId: ContactId
}

export type InboxConversationModel<M extends Model = Model> = InboxModel<
  'conversation',
  InboxConversationRow,
  M
>

export function withInboxConversation(): <M extends Model>(
  superclass: M,
) => InboxConversationModel<M> {
  const mixin = (superclass: Model) => {
    class InboxConversation extends superclass {
      static readonly inboxRole = 'conversation'

      declare id: ConversationId
      declare channelId: ChannelId
      declare contactId: ContactId
    }

    return InboxConversation
  }

  // SAFETY: InboxConversation only narrows the types of columns M already has at runtime.
  return mixin as <M extends Model>(superclass: M) => InboxConversationModel<M>
}
