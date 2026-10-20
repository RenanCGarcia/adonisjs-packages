import { compose } from '@adonisjs/core/helpers'
import { belongsTo, hasMany } from '@adonisjs/lucid/orm'
import type { BelongsTo, HasMany } from '@adonisjs/lucid/types/relations'
import { withInboxChannel } from '@enzopita/adonisjs-inbox/mixins'
import { InboxChannelSchema } from '#database/schema'
import Conversation from '#models/inbox/conversation'
import Queue from '#models/inbox/queue'

export default class Channel extends compose(InboxChannelSchema, withInboxChannel()) {
  static table = 'inbox_channels'

  @belongsTo(() => Queue, { foreignKey: 'defaultQueueId' })
  declare defaultQueue: BelongsTo<typeof Queue>

  @hasMany(() => Conversation)
  declare conversations: HasMany<typeof Conversation>
}
