import type { DateTime } from 'luxon'

import { toAttendant, type AttendantRow } from '../attendant/row.ts'
import type { Attendant, AttendantId, HostUserId } from '../types.ts'
import type { InboxModel, Model } from './model.ts'

export interface InboxAttendantRow extends AttendantRow {
  /**
   * The row as the sum type the package takes, with `active` derived from `deactivatedAt`.
   */
  readonly asAttendant: Attendant
}

export type InboxAttendantModel<M extends Model = Model> = InboxModel<
  'attendant',
  InboxAttendantRow,
  M
>

export function withInboxAttendant(): <M extends Model>(superclass: M) => InboxAttendantModel<M> {
  const mixin = (superclass: Model) => {
    class InboxAttendant extends superclass {
      static readonly inboxRole = 'attendant'

      declare id: AttendantId
      declare kind: Attendant['kind']
      declare userId: HostUserId | null
      declare botKey: string | null
      declare deactivatedAt: DateTime | null

      get asAttendant() {
        return toAttendant(this)
      }
    }

    return InboxAttendant
  }

  // SAFETY: InboxAttendant declares every InboxAttendantRow member on top of M.
  return mixin as <M extends Model>(superclass: M) => InboxAttendantModel<M>
}
