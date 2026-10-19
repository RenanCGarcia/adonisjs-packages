/**
 * Domain outcomes are result unions. This is only for broken config, rows that break the
 * migration's CHECK constraints, and programmer errors.
 */
export type InboxErrorCode =
  | 'E_INBOX_INVALID_CONFIG'
  | 'E_INBOX_INVALID_ROW'
  | 'E_INBOX_UNKNOWN_PROVIDER'
  | 'E_INBOX_UNKNOWN_BOT'

export class InboxError extends Error {
  readonly code: InboxErrorCode

  constructor(code: InboxErrorCode, message: string, options?: ErrorOptions) {
    super(message, options)
    this.name = 'InboxError'
    this.code = code
  }
}
