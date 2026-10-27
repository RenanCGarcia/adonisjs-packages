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

interface Collected {
  throws: ThrowsTag[]
  responses: ResponseTag[]
  examples: ExampleTag[]
  paragraphs: string[]
  requestBody?: ts.Type
  deprecated: boolean
}

type TagReader = (context: TagContext, tag: ts.JSDocTag, collected: Collected) => void

const readThrows: TagReader = (context, tag, { throws }) => {
  const thrown = ts.isJSDocThrowsTag(tag) ? throwsTag(context, tag) : undefined

  if (thrown) throws.push(thrown)
}

const TAG_READERS = new Map<string, TagReader>([
  ['throws', readThrows],
  [
    'response',
    (context, tag, { responses }) => {
      const response = responseTag(context, tag)

      if (response) responses.push(response)
    },
  ],
  [
    'example',
    (context, tag, { examples }) => {
      const example = exampleTag(context, tag)

      if (example) examples.push(example)
    },
  ],
  [
    'requestBody',
    (context, tag, collected) => {
      collected.requestBody = requestBodyTag(context, tag)
    },
  ],
  [
    'deprecated',
    (_context, _tag, collected) => {
      collected.deprecated = true
    },
  ],
  [
    'remarks',
    (_context, tag, { paragraphs }) => {
      if (tagText(tag)) paragraphs.push(tagText(tag))
    },
  ],
])

export function operationDocs(
  environment: Omit<TagContext, 'method' | 'problems'>,
  controller: ts.ClassDeclaration,
  method: ts.MethodDeclaration,
): OperationDocs {
  const context: TagContext = { ...environment, method, problems: [] }
  const doc = jsDoc(method)
  const tags = tagsOf(doc) ?? tagsOf(jsDoc(controller))

  const [summary, ...paragraphs] = (ts.getTextOfJSDocComment(doc?.comment) ?? '')
    .split(/\n\s*\n/)
    .map(paragraph => paragraph.trim())
    .filter(Boolean)

  const collected: Collected = {
    throws: [],
    responses: [],
    examples: [],
    paragraphs,
    deprecated: false,
  }

  for (const tag of doc?.tags ?? []) {
    const read = TAG_READERS.get(tag.tagName.text)

    if (read) read(context, tag, collected)
    else context.problems.push(...unknownTag(tag, context.locate))
  }

  const { throws, responses, examples, requestBody, deprecated } = collected

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
