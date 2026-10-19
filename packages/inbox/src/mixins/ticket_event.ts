import { column } from '@adonisjs/lucid/orm'

import type { Actor, AttendantId, TicketFact, TicketId } from '../types.ts'
import { jsonText, type InboxModel, type Model } from './model.ts'

/**
 * `type` repeats `data.fact` so metrics can filter on a plain column.
 */
export interface InboxTicketEventRow {
  ticketId: TicketId
  type: TicketFact['fact']
  data: TicketFact
  actorKind: Actor['kind']
  actorId: AttendantId | null
  actorSource: string | null
  note: string | null
}

export type InboxTicketEventModel<M extends Model = Model> = InboxModel<
  'ticketEvent',
  InboxTicketEventRow,
  M
>

export function withInboxTicketEvent(): <M extends Model>(
  superclass: M,
) => InboxTicketEventModel<M> {
  const mixin = (superclass: Model) => {
    class InboxTicketEvent extends superclass {
      static readonly inboxRole = 'ticketEvent'

      declare ticketId: TicketId
      declare type: TicketFact['fact']
      declare actorKind: Actor['kind']
      declare actorId: AttendantId | null
      declare actorSource: string | null
      declare note: string | null

      @column(jsonText<TicketFact>())
      declare data: TicketFact
    }

    return InboxTicketEvent
  }

  // SAFETY: InboxTicketEvent parses data, and the other columns only narrow M's types.
  return mixin as <M extends Model>(superclass: M) => InboxTicketEventModel<M>
}
