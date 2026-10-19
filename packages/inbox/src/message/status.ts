import type { MessageStatus } from '../types.ts'

const PROGRESS = {
  pending: 0,
  sent: 1,
  delivered: 2,
  read: 3,
  played: 4,
  failed: 1,
} as const satisfies Record<MessageStatus, number>

// SAFETY: PROGRESS satisfies Record<MessageStatus, number>, so its keys are exactly the statuses.
const STATUSES = Object.keys(PROGRESS) as MessageStatus[]

/**
 * Failed is terminal, and a failure reported after delivery can't overtake it.
 */
export function advances(from: MessageStatus, to: MessageStatus) {
  if (from === 'failed') return false

  if (to === 'failed') return PROGRESS[from] <= PROGRESS.failed

  return PROGRESS[to] > PROGRESS[from]
}

/**
 * The shell writes `UPDATE ... SET status = to WHERE status IN (...)` with this list, so a status
 * webhook never reads first and a replayed or reordered one is a no-op.
 */
export function advanceableFrom(to: MessageStatus) {
  return STATUSES.filter(from => advances(from, to))
}
