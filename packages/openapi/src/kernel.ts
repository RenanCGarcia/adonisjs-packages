import ts from 'typescript'

/**
 * The module specifiers `start/kernel.ts` registers, read from its lazy `() => import('...')` entries.
 */
export interface Kernel {
  errorHandler?: string
  /**
   * The `router.use()` and `server.use()` middleware, which run on every route.
   */
  global: string[]
  named: Map<string, string>
}

function specifierOf(node: ts.Node | undefined) {
  if (!node || !ts.isArrowFunction(node) || !ts.isCallExpression(node.body)) return undefined

  const {
    expression,
    arguments: [argument],
  } = node.body

  return expression.kind === ts.SyntaxKind.ImportKeyword &&
    argument &&
    ts.isStringLiteralLike(argument)
    ? argument.text
    : undefined
}

export function readKernel(file: ts.SourceFile | undefined): Kernel {
  const kernel: Kernel = { global: [], named: new Map() }

  const visit = (node: ts.Node) => {
    if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)) {
      const [argument] = node.arguments

      switch (node.expression.name.text) {
        case 'errorHandler':
          kernel.errorHandler = specifierOf(argument) ?? kernel.errorHandler
          break
        case 'use':
          if (argument && ts.isArrayLiteralExpression(argument))
            kernel.global.push(...argument.elements.flatMap(entry => specifierOf(entry) ?? []))
          break
        case 'named':
          if (argument && ts.isObjectLiteralExpression(argument))
            for (const entry of argument.properties) {
              const specifier = ts.isPropertyAssignment(entry) && specifierOf(entry.initializer)

              if (specifier && ts.isIdentifier(entry.name))
                kernel.named.set(entry.name.text, specifier)
            }
      }
    }

    ts.forEachChild(node, visit)
  }

  if (file) visit(file)

  return kernel
}
