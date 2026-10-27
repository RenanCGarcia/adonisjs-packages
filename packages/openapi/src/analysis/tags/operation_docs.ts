import ts from 'typescript'
import type { Diagnostic } from '../../types.ts'
import { exampleTag, type ExampleTag } from './example_tag.ts'
import { unknownTag } from './known_tags.ts'
import { requestBodyTag } from './request_body_tag.ts'
import { responseTag, type ResponseTag } from './response_tag.ts'
import type { TagContext } from './tag_context.ts'
import { jsDoc, tagsOf, tagText } from './tag_text.ts'
import { throwsTag, type ThrowsTag } from './throws_tag.ts'

export interface OperationMeta {
  summary?: string
  description?: string
  tags?: string[]
  deprecated?: true
}

export interface OperationDocs {
  meta: OperationMeta
  throws: ThrowsTag[]
  /**
   * `@response {404} reason` describes a status something else documents, and
   * `@response {502} {UpstreamError}` declares a status and its body.
   */
  responses: ResponseTag[]
  examples: ExampleTag[]
  requestBody?: ts.Type
  problems: Diagnostic[]
}

export function operationDocs(
  environment: Omit<TagContext, 'method' | 'problems'>,
  controller: ts.ClassDeclaration,
  method: ts.MethodDeclaration,
): OperationDocs {
  const context: TagContext = { ...environment, method, problems: [] }
  const doc = jsDoc(method)
  const throws: ThrowsTag[] = []
  const responses: ResponseTag[] = []
  const examples: ExampleTag[] = []
  let requestBody: ts.Type | undefined
  const tags = tagsOf(doc) ?? tagsOf(jsDoc(controller))
  let deprecated = false

  const [summary, ...paragraphs] = (ts.getTextOfJSDocComment(doc?.comment) ?? '')
    .split(/\n\s*\n/)
    .map(paragraph => paragraph.trim())
    .filter(Boolean)

  for (const tag of doc?.tags ?? []) {
    const name = tag.tagName.text

    if (ts.isJSDocThrowsTag(tag)) {
      const thrown = throwsTag(context, tag)

      if (thrown) throws.push(thrown)
    } else if (name === 'response') {
      const response = responseTag(context, tag)

      if (response) responses.push(response)
    } else if (name === 'example') {
      const example = exampleTag(context, tag)

      if (example) examples.push(example)
    } else if (name === 'requestBody') requestBody = requestBodyTag(context, tag)
    else if (ts.isJSDocDeprecatedTag(tag)) deprecated = true
    else if (name === 'remarks' && tagText(tag)) paragraphs.push(tagText(tag))
    else context.problems.push(...unknownTag(tag, context.locate))
  }

  return {
    meta: {
      ...(summary && { summary }),
      ...(paragraphs.length > 0 && { description: paragraphs.join('\n\n') }),
      ...(tags?.length && { tags }),
      ...(deprecated && { deprecated: true }),
    },
    ...(requestBody && { requestBody }),
    throws,
    responses,
    examples,
    problems: context.problems,
  }
}
