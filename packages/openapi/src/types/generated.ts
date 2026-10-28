import type { OpenApiDocument } from './document.ts'

/**
 * A line of the app's sources, relative to the app root. Lines start at 1.
 */
export interface SourceLocation {
  file: string
  line: number
}

/**
 * What documented a status code of an operation.
 */
export type ResponseSource = (
  | { kind: 'return' }
  | { kind: 'answer' }
  | { kind: 'throw'; exception: string }
  | { kind: 'thrower'; call: string; exception: string; preset?: string }
  | { kind: 'middleware'; middleware: string; preset?: string }
  | { kind: 'security'; middleware: string }
  | { kind: 'validator' }
  | { kind: 'tag'; tag: '@throws' | '@response' }
) & { location?: SourceLocation }

/**
 * Codes are stable: a code keeps its meaning across releases.
 *
 * - `OA-R001`: a closure route, skipped.
 * - `OA-R002`: a handler whose return type is unknown.
 * - `OA-R003`: a function passed to `.use()` that no function of the app's sources matches.
 * - `OA-R004`: a function passed to `.use()` that several functions of the app's sources match.
 * - `OA-R005`: the lookup of the functions passed to `.use()` by their location failed.
 * - `OA-V001`: a validator whose JSON Schema cannot be read.
 * - `OA-T001`: a `@throws` that names a status code or a union instead of one class, or a class without braces.
 * - `OA-T002`: a `@throws` class name that no exception class of the app has, or several have.
 * - `OA-T003`: a `@response {N} reason` whose status nothing documents.
 * - `OA-T004`: a `@response` status that is not a status code.
 * - `OA-T005`: a `@throws` type that does not resolve to a class.
 * - `OA-T006`: an exception with no status code.
 * - `OA-T007`: a `@requestBody` or `@response` type that does not resolve, an error for `@response`.
 * - `OA-T008`: a tag the generator does not read.
 * - `OA-T009`: an `@example {N}` whose value or status cannot be read.
 * - `OA-E001`: an `errors` entry whose exception status cannot be read from its source.
 * - `OA-E002`: a package exception that renders its own body, which its declaration does not carry.
 * - `OA-E003`: an `errors.throwers` or `errors.middleware` key that matches nothing in the documented routes.
 * - `OA-S001`: an operation without tags.
 * - `OA-S002`: a tag that `document.tags` does not declare.
 * - `OA-S003`: a summary longer than `rules.summaryMaxLength`.
 * - `OA-S004`: a summary whose trailing period breaks `rules.summaryTrailingPeriod`.
 * - `OA-O001`: an `operationId` that two operations share.
 * - `OA-J001`: a type with no JSON Schema, emitted as `{}`.
 * - `OA-J002`: a Lucid model, emitted as `{}`.
 */
export type DiagnosticCode =
  | 'OA-R001'
  | 'OA-R002'
  | 'OA-R003'
  | 'OA-R004'
  | 'OA-R005'
  | 'OA-V001'
  | 'OA-T001'
  | 'OA-T002'
  | 'OA-T003'
  | 'OA-T004'
  | 'OA-T005'
  | 'OA-T006'
  | 'OA-T007'
  | 'OA-T008'
  | 'OA-T009'
  | 'OA-E001'
  | 'OA-E002'
  | 'OA-E003'
  | 'OA-S001'
  | 'OA-S002'
  | 'OA-S003'
  | 'OA-S004'
  | 'OA-O001'
  | 'OA-J001'
  | 'OA-J002'

export interface Diagnostic {
  code: DiagnosticCode
  severity: 'error' | 'warning'
  /**
   * The route name, absent for a problem of the whole document.
   */
  route?: string
  message: string
  fix?: string
  location?: SourceLocation
}

/**
 * What `generateDocument()` returns.
 */
export interface GeneratedDocument {
  document: OpenApiDocument
  diagnostics: Diagnostic[]
  /**
   * Route name to status code to what documented that response, in the order it was read.
   */
  provenance: Record<string, Record<string, ResponseSource[]>>
}
