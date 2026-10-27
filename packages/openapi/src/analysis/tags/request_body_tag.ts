import type ts from 'typescript'
import { namedType } from './named_type.ts'
import type { TagContext } from './tag_context.ts'
import { tagText } from './tag_text.ts'

export function requestBodyTag(context: TagContext, tag: ts.JSDocTag) {
  const text = /^\{(.*)\}$/s.exec(tagText(tag))?.[1] ?? ''

  return namedType(context, tag, text)
}
