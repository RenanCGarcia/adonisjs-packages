import type { OperationMeta } from '../analysis/tags/operation_docs.ts'
import { longSummary, summaryPeriod, undeclaredTag, untagged } from '../diagnostics/operation.ts'
import type { Diagnostic, OpenApiConfig, SourceLocation } from '../types.ts'

/**
 * Checks the tags of an operation against `document.tags`, and its summary against `rules`.
 */
export function operationRules(
  route: string,
  { tags, summary }: OperationMeta,
  { document, rules }: Pick<OpenApiConfig, 'document' | 'rules'>,
  location?: SourceLocation,
): Diagnostic[] {
  const declared = new Set(document.tags.map(({ name }) => name))
  const diagnostics: Diagnostic[] = []

  if (!tags?.length) diagnostics.push(untagged(route, location))

  for (const tag of tags ?? [])
    if (!declared.has(tag)) diagnostics.push(undeclaredTag(route, tag, location))

  if (!summary) return diagnostics

  if (rules.summaryMaxLength !== undefined && summary.length > rules.summaryMaxLength)
    diagnostics.push(longSummary(route, rules.summaryMaxLength, location))

  if (
    rules.summaryTrailingPeriod !== undefined &&
    summary.endsWith('.') !== rules.summaryTrailingPeriod
  )
    diagnostics.push(summaryPeriod(route, rules.summaryTrailingPeriod, location))

  return diagnostics
}
