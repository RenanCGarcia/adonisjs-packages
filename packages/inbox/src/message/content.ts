import { InboxError } from '../errors.ts'
import type { MessageContent, MessageId, MessageKind } from '../types.ts'

/**
 * How a message's content is stored: its kind, and a body whose shape the kind decides.
 */
export interface ContentColumns {
  kind: MessageKind
  body: string
}

export function toContentColumns(content: MessageContent): ContentColumns {
  switch (content.kind) {
    case 'text':
      return { kind: 'text', body: content.text }
    default: {
      const unhandled: never = content.kind

      return unhandled
    }
  }
}

export function toContent(row: ContentColumns & { id: MessageId }): MessageContent {
  switch (row.kind) {
    case 'text':
      return { kind: 'text', text: row.body }
    default: {
      const unknown: never = row.kind

      throw new InboxError(
        'E_INBOX_INVALID_ROW',
        `inbox: message ${row.id} has kind "${String(unknown)}", which this version can't read`,
      )
    }
  }
}
