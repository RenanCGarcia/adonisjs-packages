import ts from 'typescript'
import { isAppSource } from './symbols.ts'

export interface ResponseCalls {
  calls: { name: string; call: ts.CallExpression }[]
  throws: ts.NewExpression[]
  /**
   * Every other call, which an `errors.throwers` key can name.
   */
  invoked: ts.CallExpression[]
}

/**
 * The calls `roots` make on an `HttpResponse` and the exceptions they `throw new`, also inside the
 * functions of the app they call, such as a shared `renderError(ctx, error)`. Functions from
 * packages are not followed, and neither are the nodes in `skip`.
 */
export function responseCalls(
  checker: ts.TypeChecker,
  roots: ts.Node[],
  skip = new Set<ts.Node>(),
): ResponseCalls {
  const found: ResponseCalls = { calls: [], throws: [], invoked: [] }
  const visited = new Set<ts.Node>(roots)

  const visit = (node: ts.Node) => {
    if (skip.has(node)) return

    if (ts.isThrowStatement(node) && node.expression && ts.isNewExpression(node.expression))
      found.throws.push(node.expression)

    if (ts.isCallExpression(node)) {
      const callee = node.expression

      const receiver =
        ts.isPropertyAccessExpression(callee) && checker.getTypeAtLocation(callee.expression)

      if (receiver && receiver.getSymbol()?.name === 'HttpResponse')
        found.calls.push({ name: callee.name.text, call: node })
      else {
        found.invoked.push(node)
        follow(checker.getResolvedSignature(node)?.declaration)
      }
    }

    ts.forEachChild(node, visit)
  }

  const follow = (declaration: ts.Declaration | undefined) => {
    const body = declaration && bodyOf(declaration)

    if (!body || visited.has(body)) return

    visited.add(body)
    visit(body)
  }

  for (const root of roots) visit(root)

  return found
}

export function bodyOf(declaration: ts.Declaration) {
  const body =
    ts.isFunctionDeclaration(declaration) ||
    ts.isMethodDeclaration(declaration) ||
    ts.isFunctionExpression(declaration) ||
    ts.isArrowFunction(declaration)
      ? declaration.body
      : undefined

  return body && isAppSource(declaration.getSourceFile()) ? body : undefined
}

export function methodBodies(checker: ts.TypeChecker, instance: ts.Type, methods: string[]) {
  return methods.flatMap(method => {
    const declaration = checker.getPropertyOfType(instance, method)?.valueDeclaration

    return declaration ? (bodyOf(declaration) ?? []) : []
  })
}
