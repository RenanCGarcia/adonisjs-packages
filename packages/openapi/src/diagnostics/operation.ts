import type { Diagnostic, SourceLocation } from '../types.ts'

export function untagged(route: string, location?: SourceLocation): Diagnostic {
  return {
    code: 'OA-S001',
    severity: 'warning',
    route,
    message: 'the operation has no tags',
    fix: 'add @tags to the action or to its controller class',
    ...(location && { location }),
  }
}

export function undeclaredTag(route: string, tag: string, location?: SourceLocation): Diagnostic {
  return {
    code: 'OA-S002',
    severity: 'warning',
    route,
    message: `the tag ${tag} is not declared`,
    fix: `add { name: '${tag}' } to document.tags in config/openapi.ts`,
    ...(location && { location }),
  }
}

export function longSummary(route: string, max: number, location?: SourceLocation): Diagnostic {
  return {
    code: 'OA-S003',
    severity: 'warning',
    route,
    message: `the summary is longer than ${max} characters`,
    fix: 'shorten the first paragraph of the comment, and move the rest to the next paragraph',
    ...(location && { location }),
  }
}

export function summaryPeriod(
  route: string,
  wanted: boolean,
  location?: SourceLocation,
): Diagnostic {
  return {
    code: 'OA-S004',
    severity: 'warning',
    route,
    message: wanted ? 'the summary does not end with a period' : 'the summary ends with a period',
    fix: wanted ? 'end the summary with a period' : 'remove the period at the end of the summary',
    ...(location && { location }),
  }
}
