import ts from 'typescript'
import { aliased, answersOf, methodBodies, responseCalls, type Answer } from './operation_docs.ts'

/**
 * An `if (error instanceof X)` branch of the exception handler, and what it answers with.
 */
export interface HandlerBranch {
  symbol: ts.Symbol
  answers: Answer[]
}

export interface ExceptionHandlerAnswers {
  /**
   * The branches of `handle()`, which run before the `handle()` of the exception itself.
   */
  handled: HandlerBranch[]
  /**
   * The branches of `renderErrorAsJSON()`, which only exceptions without a `handle()` reach.
   */
  rendered: HandlerBranch[]
  /**
   * What the handler sends outside its branches with the status of the error.
   */
  generic: Answer[]
}

/**
 * The classes a condition such as `error instanceof A || error instanceof B` names, or none when
 * it also checks something else, such as a `code` or a status, which names no class.
 */
function instanceofClasses(condition: ts.Expression): ts.Expression[] | undefined {
  while (ts.isParenthesizedExpression(condition)) condition = condition.expression

  if (!ts.isBinaryExpression(condition)) return undefined

  if (condition.operatorToken.kind === ts.SyntaxKind.InstanceOfKeyword) return [condition.right]

  if (condition.operatorToken.kind !== ts.SyntaxKind.BarBarToken) return undefined

  const left = instanceofClasses(condition.left)
  const right = instanceofClasses(condition.right)

  return left && right && [...left, ...right]
}

function instanceofBranches(checker: ts.TypeChecker, body: ts.Node) {
  const branches: { symbol: ts.Symbol; body: ts.Statement }[] = []

  const visit = (node: ts.Node) => {
    if (ts.isIfStatement(node))
      for (const name of instanceofClasses(node.expression) ?? []) {
        const symbol = checker.getSymbolAtLocation(name)

        if (symbol) branches.push({ symbol: aliased(checker, symbol), body: node.thenStatement })
      }

    ts.forEachChild(node, visit)
  }

  visit(body)

  return branches
}

/**
 * What the app's exception handler answers with, read from its `handle()` and
 * `renderErrorAsJSON()`. A condition made of `instanceof` checks alone, joined by `||`, makes a
 * branch for each class.
 */
export function exceptionHandlerAnswers(
  checker: ts.TypeChecker,
  instance: ts.Type,
): ExceptionHandlerAnswers {
  const read = (method: string) => {
    const bodies = methodBodies(checker, instance, [method])
    const branches = bodies.flatMap(body => instanceofBranches(checker, body))
    const skip = new Set<ts.Node>(branches.map(({ body }) => body))

    return {
      branches: branches.map(({ symbol, body }) => ({
        symbol,
        answers: answersOf(checker, responseCalls(checker, [body]).calls),
      })),
      generic: answersOf(checker, responseCalls(checker, bodies, skip).calls).filter(
        answer => answer.code === undefined && answer.body,
      ),
    }
  }

  const handle = read('handle')
  const render = read('renderErrorAsJSON')

  return {
    handled: handle.branches,
    rendered: render.branches,
    generic: [...handle.generic, ...render.generic],
  }
}
