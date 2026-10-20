import type { DateTime } from 'luxon'

import { InboxError } from '../errors.ts'
import type { Attendant, AttendantId, BotKey, HostUserId } from '../types.ts'

/**
 * The columns of `inbox_attendants`, as model attributes. A CHECK constraint gives a human a user
 * id and a bot a bot key, never both or neither. The bot key is a plain string here: `BotKey`
 * comes from the host's config, whose type depends on this model's, and a host mixin composed
 * after the inbox's makes TypeScript resolve that cycle while it types the model.
 */
export interface AttendantRow {
  id: AttendantId
  kind: Attendant['kind']
  userId: HostUserId | null
  botKey: string | null
  deactivatedAt: DateTime | null
}

export function toAttendant(row: AttendantRow): Attendant {
  const active = row.deactivatedAt === null

  if (row.kind === 'human' && row.userId !== null) {
    return { kind: 'human', id: row.id, userId: row.userId, active }
  }

  if (row.kind === 'bot' && row.botKey !== null) {
    // SAFETY: the inbox only stores keys of config.bots.
    return { kind: 'bot', id: row.id, botKey: row.botKey as BotKey, active }
  }

  throw new InboxError(
    'E_INBOX_INVALID_ROW',
    `inbox: attendant ${row.id} is a ${row.kind} with user ${row.userId} and bot key ${row.botKey}, which the migration's CHECK constraint forbids`,
  )
}
