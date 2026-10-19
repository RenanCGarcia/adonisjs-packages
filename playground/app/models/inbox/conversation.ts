import { compose } from '@adonisjs/core/helpers'
import { belongsTo, hasMany } from '@adonisjs/lucid/orm'
import type { BelongsTo, HasMany } from '@adonisjs/lucid/types/relations'
import { withInboxConversation } from '@enzopita/adonisjs-inbox/mixins'
import { InboxConversationSchema } from '#database/schema'
import Channel from '#models/inbox/channel'
import Contact from '#models/inbox/contact'
import Message from '#models/inbox/message'
import Ticket from '#models/inbox/ticket'

export default class Conversation extends compose(
  InboxConversationSchema,
  withInboxConversation(),
) {
  static table = 'inbox_conversations'

  @belongsTo(() => Channel)
  declare channel: BelongsTo<typeof Channel>

  @belongsTo(() => Contact)
  declare contact: BelongsTo<typeof Contact>

  @hasMany(() => Ticket)
  declare tickets: HasMany<typeof Ticket>

  @hasMany(() => Message)
  declare messages: HasMany<typeof Message>
}
