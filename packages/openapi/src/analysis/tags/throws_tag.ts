import ts from 'typescript'
import {
  throwsClassUnresolved,
  throwsNamesSeveralClasses,
  throwsNamesStatus,
  throwsNotAClass,
  throwsStatusWithoutBraces,
  throwsTypeUnresolved,
  throwsWithoutBraces,
} from '../../diagnostics/tags.ts'
import { exceptionType, type ExceptionType } from '../exceptions/exception_class.ts'
import { aliased, importedSymbol, qualifiedNames } from '../symbols.ts'
import type { TagContext } from './tag_context.ts'
import { reasonOf, statusText, tagText } from './tag_text.ts'

export interface ThrowsTag {
  exception: ExceptionType
  reason?: string
  tag: ts.JSDocTag
}

/**
 * `@throws {SmsRejectedException}` parses as a reference to the class, resolved in the scope of the
 * controller and else by name among the exception classes of the app. `@throws {404}` and
 * `@throws {AException | BException}` are a literal and a union, which 1.0 no longer reads.
 */
function thrownClass(
  { checker, resolveModule, findException, locate, problems }: TagContext,
  type: ts.TypeNode,
): ExceptionType | undefined {
  const written = type.getText()
  const location = locate(type)

  if (ts.isUnionTypeNode(type)) {
    problems.push(throwsNamesSeveralClasses(location, written))

    return undefined
  }

  if (ts.isLiteralTypeNode(type) && ts.isNumericLiteral(type.literal)) {
    problems.push(throwsNamesStatus(location, written, type.literal.text))

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
    problems.push(throwsNotAClass(location, written))

    return undefined
  }

  if (ts.isTypeReferenceNode(type) && ts.isIdentifier(type.typeName)) {
    const name = type.typeName.text
    const { found, names } = findException(name)

    if (found.length === 1) return found[0]!.exception

    problems.push(
      throwsClassUnresolved(
        location,
        written,
        name,
        found.map(({ file }) => file),
        names,
      ),
    )

    return undefined
  }

  problems.push(throwsTypeUnresolved(location, written, ts.isImportTypeNode(type)))

  return undefined
}

/**
 * `@throws EmailTakenException` or `@throws 404 Not found`, as a 0.x tag rewritten by hand may read:
 * without braces, the type is only text.
 */
function unbraced({ locate }: TagContext, tag: ts.JSDocThrowsTag) {
  const [word = ''] = tagText(tag).split(/\s/)
  const location = locate(tag)

  return statusText(word)
    ? throwsStatusWithoutBraces(location, word)
    : throwsWithoutBraces(location, word)
}

export function throwsTag(context: TagContext, tag: ts.JSDocThrowsTag): ThrowsTag | undefined {
  if (!tag.typeExpression) {
    context.problems.push(unbraced(context, tag))

    return undefined
  }

  const exception = thrownClass(context, tag.typeExpression.type)
  const reason = reasonOf(tagText(tag))

  return exception && { exception, ...(reason && { reason }), tag }
}
