import ts from 'typescript'

function arrayLiteral(
  checker: ts.TypeChecker,
  node: ts.Node | undefined,
  seen = new Set<ts.Node>(),
): ts.ArrayLiteralExpression | undefined {
  if (!node || seen.has(node)) return undefined

  seen.add(node)

  if (ts.isArrayLiteralExpression(node)) return node

  if (
    ts.isAsExpression(node) ||
    ts.isSatisfiesExpression(node) ||
    ts.isParenthesizedExpression(node) ||
    ts.isTypeAssertionExpression(node)
  )
    return arrayLiteral(checker, node.expression, seen)

  if (!ts.isIdentifier(node)) return undefined

  let symbol = checker.getSymbolAtLocation(node)

  if (symbol && symbol.flags & ts.SymbolFlags.Alias) symbol = checker.getAliasedSymbol(symbol)

  const declaration = symbol?.valueDeclaration

  return declaration && ts.isVariableDeclaration(declaration)
    ? arrayLiteral(checker, declaration.initializer, seen)
    : undefined
}

function elementsOf(
  checker: ts.TypeChecker,
  literal: ts.ArrayLiteralExpression,
  seen: Set<ts.Node>,
): ts.Expression[] {
  return literal.elements.flatMap(element => {
    if (!ts.isSpreadElement(element)) return [element]

    const held = arrayLiteral(checker, element.expression, seen)

    return held ? elementsOf(checker, held, seen) : [element]
  })
}

interface WrittenItem {
  element: ts.Expression
  index: number
  runtimeIndex?: number
}

function writtenItems(elements: ts.Expression[], count: number): WrittenItem[] {
  const first = elements.findIndex(ts.isSpreadElement)
  const tail = first === -1 ? 0 : elements.length - 1 - elements.findLastIndex(ts.isSpreadElement)

  return elements.flatMap((element, index) => {
    if (ts.isSpreadElement(element)) return []

    if (first === -1 || index < first)
      return index < count ? [{ element, index, runtimeIndex: index }] : []

    const fromEnd = elements.length - index

    return fromEnd <= tail
      ? [{ element, index, runtimeIndex: count - fromEnd }]
      : [{ element, index }]
  })
}

export function arrayItems(checker: ts.TypeChecker, node: ts.Node | undefined, count: number) {
  const seen = new Set<ts.Node>()
  const literal = arrayLiteral(checker, node, seen)

  if (!literal) return undefined

  const elements = elementsOf(checker, literal, seen)

  return {
    items: writtenItems(elements, count),
    unreadable: elements.filter(ts.isSpreadElement),
  }
}
