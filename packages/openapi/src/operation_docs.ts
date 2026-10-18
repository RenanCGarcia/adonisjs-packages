import { STATUS_CODES } from 'node:http'
import ts from 'typescript'

export interface OperationDocs {
  summary?: string
  description?: string
  tags?: string[]
  deprecated?: true
  /**
   * Status code to description, from `@throws {404} User not found`.
   */
  responses: Record<string, string>
}

function jsDoc(node: ts.Node) {
  return ts.getJSDocCommentsAndTags(node).filter(ts.isJSDoc).at(-1)
}

function tagText(tag: ts.JSDocTag) {
  return ts.getTextOfJSDocComment(tag.comment)?.trim() ?? ''
}

function tagsOf(doc: ts.JSDoc | undefined) {
  const tag = doc?.tags?.find(candidate => candidate.tagName.text === 'tags')

  return (
    tag &&
    tagText(tag)
      .split(',')
      .map(name => name.trim())
      .filter(Boolean)
  )
}

/**
 * `@throws {404}` parses as a JSDoc type expression holding the literal type `404`.
 */
function thrownStatus(tag: ts.JSDocTag) {
  const type = ts.isJSDocThrowsTag(tag) ? tag.typeExpression?.type : undefined

  if (!type || !ts.isLiteralTypeNode(type) || !ts.isNumericLiteral(type.literal)) return undefined

  return /^\d{3}$/.test(type.literal.text) ? type.literal.text : undefined
}

export function operationDocs(
  controller: ts.ClassDeclaration,
  method: ts.MethodDeclaration,
): OperationDocs {
  const doc = jsDoc(method)
  const responses: Record<string, string> = {}
  const tags = tagsOf(doc) ?? tagsOf(jsDoc(controller))
  let deprecated = false

  const [summary, ...paragraphs] = (ts.getTextOfJSDocComment(doc?.comment) ?? '')
    .split(/\n\s*\n/)
    .map(paragraph => paragraph.trim())
    .filter(Boolean)

  for (const tag of doc?.tags ?? []) {
    const status = thrownStatus(tag)

    if (status) responses[status] = tagText(tag) || (STATUS_CODES[Number(status)] ?? status)
    else if (ts.isJSDocDeprecatedTag(tag)) deprecated = true
    else if (tag.tagName.text === 'remarks' && tagText(tag)) paragraphs.push(tagText(tag))
  }

  return {
    ...(summary && { summary }),
    ...(paragraphs.length > 0 && { description: paragraphs.join('\n\n') }),
    ...(tags?.length && { tags }),
    ...(deprecated && { deprecated: true }),
    responses,
  }
}
