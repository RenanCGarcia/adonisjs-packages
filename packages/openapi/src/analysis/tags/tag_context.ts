import type ts from 'typescript'
import type { ResolveModule } from '../symbols.ts'
import type { FindException } from '../exceptions/exception_index.ts'
import type { Diagnostic, SourceLocation } from '../../types.ts'

/**
 * What reading the tags of one action needs. A tag that cannot be documented adds a diagnostic to
 * `problems` and yields nothing.
 */
export interface TagContext {
  checker: ts.TypeChecker
  resolveModule: ResolveModule
  findException: FindException
  locate: (node: ts.Node) => SourceLocation
  method: ts.MethodDeclaration
  problems: Diagnostic[]
}
