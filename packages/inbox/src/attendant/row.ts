import type { DateTime } from 'luxon'

import { InboxError } from '../errors.ts'
import type { Attendant, AttendantId, BotKey, HostUserId } from '../types.ts'

/**
 * The columns of `inbox_attendants`, as model attributes. A CHECK constraint gives a human a user
 * id and a bot a bot key, never both or neither.
 */
export interface AttendantRow {
  id: AttendantId
  kind: Attendant['kind']
  userId: HostUserId | null
  botKey: BotKey | null
  deactivatedAt: DateTime | null
}

export function toAttendant(row: AttendantRow): Attendant {
  const active = row.deactivatedAt === null

  if (row.kind === 'human' && row.userId !== null) {
    return { kind: 'human', id: row.id, userId: row.userId, active }
  }

  if (row.kind === 'bot' && row.botKey !== null) {
    return { kind: 'bot', id: row.id, botKey: row.botKey, active }
  }

  throw new InboxError(
    'E_INBOX_INVALID_ROW',
    `inbox: attendant ${row.id} is a ${row.kind} with user ${row.userId} and bot key ${row.botKey}, which the migration's CHECK constraint forbids`,
  )
}
