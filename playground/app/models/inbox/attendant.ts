import { compose } from '@adonisjs/core/helpers'
import { belongsTo, hasMany } from '@adonisjs/lucid/orm'
import type { BelongsTo, HasMany } from '@adonisjs/lucid/types/relations'
import { withInboxAttendant } from '@enzopita/adonisjs-inbox/mixins'
import { InboxAttendantSchema } from '#database/schema'
import QueueMember from '#models/inbox/queue_member'
import Ticket from '#models/inbox/ticket'
import User from '#models/user'

export default class Attendant extends compose(InboxAttendantSchema, withInboxAttendant()) {
  static table = 'inbox_attendants'

  @belongsTo(() => User)
  declare user: BelongsTo<typeof User>

  @hasMany(() => QueueMember)
  declare memberships: HasMany<typeof QueueMember>

  @hasMany(() => Ticket, { foreignKey: 'assigneeId' })
  declare tickets: HasMany<typeof Ticket>

  /**
   * Who the attendant is, for a reader. Needs `user` preloaded on a human.
   */
  get ref() {
    const attendant = this.asAttendant

    if (attendant.kind === 'bot') {
      return { id: attendant.id, kind: attendant.kind, name: attendant.botKey }
    }

    // The inbox keeps no foreign key to users, so the user row may be gone.
    const user: User | null = this.user
    const name = user === null ? `user #${attendant.userId}` : (user.fullName ?? user.email)

    return { id: attendant.id, kind: attendant.kind, name }
  }
}
