import ts from 'typescript'
import { exceptionType, type ExceptionType } from './exception_class.ts'
import {
  aliased,
  importedSymbol,
  qualifiedNames,
  tagText,
  type Problem,
  type ResolveModule,
} from './operation_docs.ts'
import type { Diagnostic, SourceLocation } from './types.ts'

export interface ThrowsTag {
  exception: ExceptionType
  reason?: string
  tag: ts.JSDocTag
}

/**
 * The exception classes of the app with this name, with the file of each, and the names of all of them.
 */
export type FindException = (name: string) => {
  found: { exception: ExceptionType; file: string }[]
  names: string[]
}

function statusFix(code: string) {
  return `use \`@response {${code}} reason\` to describe a derived status, \`@response {${code}} {Type}\` to declare a body, or \`@throws {Class}\``
}

export function reasonOf(text: string) {
  return text.replace(/\s*\n\s*/g, ' ').trim() || undefined
}

/**
 * `@throws {SmsRejectedException}` parses as a reference to the class, resolved in the scope of the
 * controller and else by name among the exception classes of the app. `@throws {404}` and
 * `@throws {AException | BException}` are a literal and a union, which 1.0 no longer reads.
 */
function thrownClass(
  checker: ts.TypeChecker,
  resolveModule: ResolveModule,
  findException: FindException,
  type: ts.TypeNode,
  problems: Problem[],
): ExceptionType | undefined {
  const message = `@throws: ${type.getText()}`

  if (ts.isUnionTypeNode(type)) {
    problems.push({
      code: 'OA-T001',
      severity: 'error',
      message: `${message} names several classes`,
      fix: 'write one @throws tag per class',
      node: type,
    })

    return undefined
  }

  if (ts.isLiteralTypeNode(type) && ts.isNumericLiteral(type.literal)) {
    const code = type.literal.text

    problems.push({
      code: 'OA-T001',
      severity: 'error',
      message: `${message} names a status code, not an exception class`,
      fix: statusFix(code),
      node: type,
    })

    return undefined
  }

  let symbol: ts.Symbol | undefined

  if (ts.isTypeReferenceNode(type)) symbol = checker.getSymbolAtLocation(type.typeName)
  else if (
    ts.isImportTypeNode(type) &&
    ts.isLiteralTypeNode(type.argument) &&
    ts.isStringLiteral(type.argument.literal)
  )
    symbol = importedSymbol(
      checker,
      resolveModule,
      type.argument.literal.text,
      type.qualifier ? qualifiedNames(type.qualifier) : [],
      type.getSourceFile(),
    )

  const exception = exceptionType(checker, symbol)

  if (exception) return exception

  if (symbol && aliased(checker, symbol).declarations?.length) {
    problems.push({
      code: 'OA-T005',
      severity: 'warning',
      message: `${message} is not a class`,
      node: type,
    })

    return undefined
  }

  if (ts.isTypeReferenceNode(type) && ts.isIdentifier(type.typeName)) {
    const name = type.typeName.text
    const { found, names } = findException(name)

    if (found.length === 1) return found[0]!.exception

    problems.push({
      code: 'OA-T002',
      severity: 'error',
      message: found.length
        ? `${message}: several exception classes are named ${name}: ${found.map(({ file }) => file).join(', ')}`
        : `${message}: no exception class of the app is named ${name}${names.length ? ` (found ${names.join(', ')})` : ''}`,
      fix: found.length
        ? `name one as import('...').default`
        : 'import it in the controller or name it as import(...).Export',
      node: type,
    })

    return undefined
  }

  problems.push({
    code: 'OA-T005',
    severity: 'warning',
    message: ts.isImportTypeNode(type)
      ? `${message} does not name an export of a module`
      : `${message} is not in scope`,
    ...(!ts.isImportTypeNode(type) && {
      fix: 'import it in the controller or name it as import(...).Export',
    }),
    node: type,
  })

  return undefined
}

/**
 * `@throws EmailTakenException` or `@throws 404 Not found`, as a 0.x tag rewritten by hand may read:
 * without braces, the type is only text.
 */
function unbraced(tag: ts.JSDocThrowsTag): Problem {
  const [word = ''] = tagText(tag).split(/\s/)

  if (/^[1-5]\d\d$/.test(word))
    return {
      code: 'OA-T001',
      severity: 'error',
      message: `@throws ${word} names a status code, not an exception class`,
      fix: statusFix(word),
      node: tag,
    }

  return {
    code: 'OA-T001',
    severity: 'error',
    message: word ? `@throws ${word} has no braces around the class` : '@throws names no class',
    fix: `write it as \`@throws {${word || 'Class'}} reason\``,
    node: tag,
  }
}

export function throwsTag(
  checker: ts.TypeChecker,
  resolveModule: ResolveModule,
  findException: FindException,
  tag: ts.JSDocThrowsTag,
  problems: Problem[],
): ThrowsTag | undefined {
  if (!tag.typeExpression) {
    problems.push(unbraced(tag))

    return undefined
  }

  const exception = thrownClass(
    checker,
    resolveModule,
    findException,
    tag.typeExpression.type,
    problems,
  )

  const reason = reasonOf(tagText(tag))

  return exception && { exception, ...(reason && { reason }), tag }
}

export function statuslessException(
  route: string,
  exception: ExceptionType,
  location: SourceLocation,
): Diagnostic {
  return {
    code: 'OA-T006',
    severity: 'warning',
    route,
    message: `@throws: ${exception.name} has no status code`,
    fix: 'give it a literal `static status`, call `response.status(...)` with one in `handle()` or answer with a helper such as `response.conflict(body)`',
    location,
  }
}
