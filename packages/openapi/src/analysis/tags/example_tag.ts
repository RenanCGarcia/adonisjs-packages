import ts from 'typescript'
import { exampleInvalid } from '../../diagnostics/tags.ts'
import type { Json } from '../../types/json.ts'
import { aliased, importedSymbol } from '../symbols.ts'
import type { TagContext } from './tag_context.ts'
import { statusText, tagText } from './tag_text.ts'

export interface ExampleTag {
  code: string
  value: Json
  tag: ts.JSDocTag
}

function staticJson(node: ts.Expression): Json | undefined {
  if (
    ts.isAsExpression(node) ||
    ts.isSatisfiesExpression(node) ||
    ts.isParenthesizedExpression(node)
  )
    return staticJson(node.expression)

  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return node.text

  if (ts.isNumericLiteral(node)) return Number(node.text)

  if (
    ts.isPrefixUnaryExpression(node) &&
    node.operator === ts.SyntaxKind.MinusToken &&
    ts.isNumericLiteral(node.operand)
  )
    return -Number(node.operand.text)

  if (node.kind === ts.SyntaxKind.TrueKeyword) return true

  if (node.kind === ts.SyntaxKind.FalseKeyword) return false

  if (node.kind === ts.SyntaxKind.NullKeyword) return null

  if (ts.isArrayLiteralExpression(node)) {
    const items = node.elements.map(staticJson)

    return items.every(item => item !== undefined) ? items : undefined
  }

  if (!ts.isObjectLiteralExpression(node)) return undefined

  const entries: [string, Json][] = []

  for (const property of node.properties) {
    if (!ts.isPropertyAssignment(property)) return undefined

    const key = property.name
    const name = ts.isIdentifier(key) || ts.isStringLiteral(key) ? key.text : undefined
    const value = staticJson(property.initializer)

    if (name === undefined || value === undefined) return undefined

    entries.push([name, value])
  }

  return Object.fromEntries(entries)
}

/**
 * `@example {200} name` or `@example {200} import('#examples/users').list`: a `const` whose
 * initializer is JSON. An `@example` without a status is a code sample for readers.
 */
export function exampleTag(
  { checker, resolveModule, method, locate, problems }: TagContext,
  tag: ts.JSDocTag,
): ExampleTag | undefined {
  const match = /^\{([^}]*)\}(.*)$/s.exec(tagText(tag))

  if (!match) return undefined

  const status = match[1]!.trim()
  const text = match[2]!.trim()
  const written = `@example {${status}} ${text}`.trim()
  const code = statusText(status)

  if (!code) {
    problems.push(exampleInvalid(locate(tag), written, `${status} is not a status code`))

    return undefined
  }

  const name = /^[\w$]+$/.exec(text)?.[0]
  const imported = /^import\(\s*(['"])(.+?)\1\s*\)((?:\.[\w$]+)+)$/.exec(text)

  const symbol = imported
    ? importedSymbol(
        checker,
        resolveModule,
        imported[2]!,
        imported[3]!.slice(1).split('.'),
        method.getSourceFile(),
      )
    : name &&
      checker
        .getSymbolsInScope(method, ts.SymbolFlags.Value | ts.SymbolFlags.Alias)
        .find(candidate => candidate.name === name)

  if (!symbol) {
    problems.push(exampleInvalid(locate(tag), written, `${text || 'no value'} is not in scope`))

    return undefined
  }

  const declaration = aliased(checker, checker.getExportSymbolOfSymbol(symbol)).valueDeclaration

  const value =
    declaration &&
    ts.isVariableDeclaration(declaration) &&
    declaration.initializer &&
    ts.isVariableDeclarationList(declaration.parent) &&
    declaration.parent.flags & ts.NodeFlags.Const
      ? staticJson(declaration.initializer)
      : undefined

  if (value === undefined) {
    problems.push(exampleInvalid(locate(tag), written, `${text} is not a const holding JSON`))

    return undefined
  }

  return { code, value, tag }
}
