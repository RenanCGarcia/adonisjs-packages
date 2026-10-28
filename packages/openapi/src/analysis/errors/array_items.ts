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

function alignItems(elements: ts.Expression[], count: number) {
  const first = elements.findIndex(ts.isSpreadElement)

  if (first === -1) return elements.slice(0, count)

  const tail = elements.length - 1 - elements.findLastIndex(ts.isSpreadElement)

  return Array.from({ length: count }, (_, index) => {
    if (index < first) return elements[index]

    return index >= count - tail ? elements[elements.length - (count - index)] : undefined
  })
}

export function arrayItems(checker: ts.TypeChecker, node: ts.Node | undefined, count: number) {
  const seen = new Set<ts.Node>()
  const literal = arrayLiteral(checker, node, seen)

  if (!literal) return undefined

  const elements = elementsOf(checker, literal, seen)

  return {
    items: alignItems(elements, count),
    unreadable: elements.filter(ts.isSpreadElement),
  }
}
