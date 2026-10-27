import ts from 'typescript'
import { namedType, tagText, type Problem, type ResolveModule } from './operation_docs.ts'
import { reasonOf } from './throws_tag.ts'
import type { Diagnostic, SourceLocation } from './types.ts'

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
export function responseTag(
  checker: ts.TypeChecker,
  resolveModule: ResolveModule,
  method: ts.MethodDeclaration,
  tag: ts.JSDocTag,
  problems: Problem[],
): ResponseTag | undefined {
  const parsed = braced(tagText(tag))
  const status = parsed?.inner.trim() ?? ''
  const code = /^[1-5]\d\d$/.test(status) ? status : undefined

  if (!parsed || !code) {
    problems.push({
      code: 'OA-T004',
      severity: 'warning',
      message: `@response: ${parsed ? `${status} is not a status code` : 'expected a status code'}`,
      fix: 'write it as @response {404} reason or @response {404} {Type} reason',
      node: tag,
    })

    return undefined
  }

  const type = braced(parsed.rest)
  const reason = reasonOf(type ? type.rest : parsed.rest)

  if (!type) return { code, ...(reason && { reason }), tag }

  // A declared response whose type does not resolve would vanish from the document, so it fails generation.
  const unresolved: Problem[] = []

  if (type.inner.trim().startsWith('{'))
    unresolved.push({
      code: 'OA-T007',
      severity: 'error',
      message: `@response {${code}} {${type.inner.trim()}}: an inline object type is not read`,
      fix: `declare it as a type, such as \`type Body = ${type.inner.trim()}\`, and write \`@response {${code}} {Body}\``,
      node: tag,
    })

  const body =
    !unresolved.length && namedType(checker, resolveModule, method, tag, type.inner, unresolved)

  problems.push(...unresolved.map(problem => ({ ...problem, severity: 'error' as const })))

  return body ? { code, body, ...(reason && { reason }), tag } : undefined
}

/**
 * The tags to document, a declared body first so a reason alone can describe the status it
 * declares, and the reasons for a status nothing documents.
 */
export function applicable(tags: ResponseTag[], documented: (code: string) => boolean) {
  const declared = tags.filter(({ body }) => body)
  const codes = new Set(declared.map(({ code }) => code))
  const described = tags.filter(({ body }) => !body)
  const derived = ({ code }: ResponseTag) => documented(code) || codes.has(code)

  return {
    apply: [...declared, ...described.filter(derived)],
    underived: described.filter(tag => !derived(tag)),
  }
}

export function underivedResponse(
  route: string,
  code: string,
  location: SourceLocation,
): Diagnostic {
  return {
    code: 'OA-T003',
    severity: 'error',
    route,
    message: `@response {${code}}: nothing documents a ${code} for this route`,
    fix: `declare its body with \`@response {${code}} {Type}\`, or remove the tag`,
    location,
  }
}
