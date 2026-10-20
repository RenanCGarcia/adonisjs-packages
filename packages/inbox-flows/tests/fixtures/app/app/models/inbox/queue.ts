import { compose } from '@adonisjs/core/helpers'
import { hasMany } from '@adonisjs/lucid/orm'
import type { HasMany } from '@adonisjs/lucid/types/relations'
import { withInboxQueue } from '@enzopita/adonisjs-inbox/mixins'
import { InboxQueueSchema } from '#database/schema'
import QueueMember from '#models/inbox/queue_member'
import Ticket from '#models/inbox/ticket'

export default class Queue extends compose(InboxQueueSchema, withInboxQueue()) {
  static table = 'inbox_queues'

  @hasMany(() => QueueMember)
  declare members: HasMany<typeof QueueMember>

  @hasMany(() => Ticket)
  declare tickets: HasMany<typeof Ticket>
}
