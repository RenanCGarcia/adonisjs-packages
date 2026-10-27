import ts from 'typescript'
import { methodBodies, responseCalls } from '../response_calls.ts'
import { aliased } from '../symbols.ts'
import { answersOf, type Answer } from '../answers.ts'

/**
 * An `if (error instanceof X)` branch of the exception handler, and what it answers with.
 */
export interface HandlerBranch {
  symbol: ts.Symbol
  answers: Answer[]
  fallsThrough: boolean
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
 * one side of an `||` names no class, such as a check of a `code` or a status.
 */
export function instanceofClasses(
  condition: ts.Expression,
): { name: ts.Expression; fallsThrough: boolean }[] | undefined {
  while (ts.isParenthesizedExpression(condition)) condition = condition.expression

  if (!ts.isBinaryExpression(condition)) return undefined

  const operator = condition.operatorToken.kind

  if (operator === ts.SyntaxKind.InstanceOfKeyword)
    return [{ name: condition.right, fallsThrough: false }]

  if (operator === ts.SyntaxKind.AmpersandAmpersandToken) {
    const classes = [condition.left, condition.right].flatMap(side =>
      (instanceofClasses(side) ?? []).map(({ name }) => ({ name, fallsThrough: true })),
    )

    return classes.length ? classes : undefined
  }

  if (operator !== ts.SyntaxKind.BarBarToken) return undefined

  const left = instanceofClasses(condition.left)
  const right = instanceofClasses(condition.right)

  return left && right && [...left, ...right]
}

function instanceofBranches(checker: ts.TypeChecker, body: ts.Node) {
  const branches: { symbol: ts.Symbol; body: ts.Statement; fallsThrough: boolean }[] = []

  const visit = (node: ts.Node) => {
    if (ts.isIfStatement(node))
      for (const { name, fallsThrough } of instanceofClasses(node.expression) ?? []) {
        const symbol = checker.getSymbolAtLocation(name)

        if (symbol)
          branches.push({
            symbol: aliased(checker, symbol),
            body: node.thenStatement,
            fallsThrough,
          })
      }

    ts.forEachChild(node, visit)
  }

  visit(body)

  return branches
}

/**
 * What the app's exception handler answers with, read from its `handle()` and
 * `renderErrorAsJSON()`. A condition made of `instanceof` checks joined by `||` makes a branch for
 * each class.
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
      branches: branches.map(({ symbol, body, fallsThrough }) => ({
        symbol,
        fallsThrough,
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
