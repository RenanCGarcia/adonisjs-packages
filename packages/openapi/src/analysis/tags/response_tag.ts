import ts from 'typescript'
import { inlineObjectType, responseStatusInvalid } from '../../diagnostics/tags.ts'
import type { Diagnostic } from '../../types.ts'
import { namedType } from './named_type.ts'
import type { TagContext } from './tag_context.ts'
import { reasonOf, statusText, tagText } from './tag_text.ts'

export interface ResponseTag {
  code: string
  body?: ts.Type
  reason?: string
  tag: ts.JSDocTag
}

/**
 * The text inside the braces `text` starts with, which may hold braces of its own, and the text
 * after them.
 */
function braced(text: string) {
  if (!text.startsWith('{')) return undefined

  let depth = 0

  for (let index = 0; index < text.length; index++) {
    if (text[index] === '{') depth++
    else if (text[index] === '}') depth--

    if (depth === 0) return { inner: text.slice(1, index), rest: text.slice(index + 1).trim() }
  }

  return undefined
}

/**
 * `@response {404} reason` or `@response {502} {UpstreamError} reason`.
 */
export function responseTag(context: TagContext, tag: ts.JSDocTag): ResponseTag | undefined {
  const parsed = braced(tagText(tag))
  const status = parsed?.inner.trim() ?? ''
  const code = statusText(status)

  if (!parsed || !code) {
    context.problems.push(responseStatusInvalid(context.locate(tag), parsed ? status : undefined))

    return undefined
  }

  const type = braced(parsed.rest)
  const reason = reasonOf(type ? type.rest : parsed.rest)

  if (!type) return { code, ...(reason && { reason }), tag }

  // A declared response whose type does not resolve would vanish from the document, so it fails generation.
  const unresolved: Diagnostic[] = []
  const inner = type.inner.trim()

  if (inner.startsWith('{')) unresolved.push(inlineObjectType(context.locate(tag), code, inner))

  const body =
    !unresolved.length && namedType({ ...context, problems: unresolved }, tag, type.inner)

  context.problems.push(...unresolved.map(problem => ({ ...problem, severity: 'error' as const })))

  return body ? { code, body, ...(reason && { reason }), tag } : undefined
}
