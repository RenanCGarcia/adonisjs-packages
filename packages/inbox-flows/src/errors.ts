/**
 * Domain outcomes are result unions. This is only for broken config and rows that break the
 * migration's CHECK constraints.
 */
export type InboxFlowsErrorCode = 'E_INBOX_FLOWS_INVALID_CONFIG' | 'E_INBOX_FLOWS_INVALID_ROW'

export class InboxFlowsError extends Error {
  readonly code: InboxFlowsErrorCode

  constructor(code: InboxFlowsErrorCode, message: string, options?: ErrorOptions) {
    super(message, options)
    this.name = 'InboxFlowsError'
    this.code = code
  }
}
