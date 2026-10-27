import type ts from 'typescript'
import { tagNotRead } from '../../diagnostics/tags.ts'
import type { Diagnostic } from '../../types.ts'
import type { TagContext } from './tag_context.ts'

const READ_TAGS = ['throws', 'response', 'requestBody', 'tags', 'deprecated', 'remarks']

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

const READ_FIX = `use ${READ_TAGS.slice(0, -1)
  .map(name => `@${name}`)
  .join(', ')} or @${READ_TAGS.at(-1)}`

/**
 * A tag the generator does not read, such as a misspelled `@reponse`.
 */
export function unknownTag(tag: ts.JSDocTag, locate: TagContext['locate']): Diagnostic[] {
  const name = tag.tagName.text

  if (READ_TAGS.includes(name) || IGNORED_TAGS.has(name)) return []

  return [tagNotRead(locate(tag), name, MOVED_TAGS.get(name) ?? READ_FIX)]
}
