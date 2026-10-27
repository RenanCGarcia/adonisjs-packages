import type ts from 'typescript'
import type { Problem } from './operation_docs.ts'

const READ_TAGS = new Set(['throws', 'response', 'requestBody', 'tags', 'deprecated', 'remarks'])

// Standard JSDoc and TSDoc tags an action can carry for its readers, which the document has no place for.
const IGNORED_TAGS = new Set([
  'param',
  'returns',
  'return',
  'see',
  'example',
  'since',
  'internal',
  'todo',
  'override',
  'inheritDoc',
  'inheritdoc',
  'author',
  'version',
  'alpha',
  'beta',
  'experimental',
  'public',
  'private',
  'protected',
])

// Tags whose content a reader expects in the document, which the generator reads from elsewhere.
const MOVED_TAGS = new Map([
  ['summary', 'the first paragraph of the comment is the summary'],
  ['description', 'the paragraphs after the first and @remarks are the description'],
  ['exception', 'use @throws {Class}'],
])

/**
 * A tag the generator does not read, such as a misspelled `@reponse`.
 */
export function unknownTag(tag: ts.JSDocTag): Problem[] {
  const name = tag.tagName.text

  if (READ_TAGS.has(name) || IGNORED_TAGS.has(name)) return []

  return [
    {
      code: 'OA-T008',
      severity: 'warning',
      message: `@${name} is not a tag the generator reads`,
      fix:
        MOVED_TAGS.get(name) ??
        'use @throws, @response, @requestBody, @tags, @deprecated or @remarks',
      node: tag,
    },
  ]
}
