import { compose } from '@adonisjs/core/helpers'
import { belongsTo, hasMany } from '@adonisjs/lucid/orm'
import type { BelongsTo, HasMany } from '@adonisjs/lucid/types/relations'
import { withInboxTicket } from '@enzopita/adonisjs-inbox/mixins'
import { InboxTicketSchema } from '#database/schema'
import Attendant from '#models/inbox/attendant'
import Conversation from '#models/inbox/conversation'
import Message from '#models/inbox/message'
import Queue from '#models/inbox/queue'
import TicketEvent from '#models/inbox/ticket_event'

export default class Ticket extends compose(InboxTicketSchema, withInboxTicket()) {
  static table = 'inbox_tickets'

  @belongsTo(() => Conversation)
  declare conversation: BelongsTo<typeof Conversation>

  @belongsTo(() => Queue)
  declare queue: BelongsTo<typeof Queue>

  @belongsTo(() => Attendant, { foreignKey: 'assigneeId' })
  declare assignee: BelongsTo<typeof Attendant>

  @hasMany(() => TicketEvent)
  declare events: HasMany<typeof TicketEvent>

  @hasMany(() => Message)
  declare messages: HasMany<typeof Message>
}
