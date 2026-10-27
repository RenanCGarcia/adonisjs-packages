import ts from 'typescript'

/**
 * The names a call is made through, without the calls in between: `bouncer.with(Policy).authorize()`
 * gives `bouncer`, `authorize`.
 */
function calleeNames(expression: ts.Expression): string[] {
  if (ts.isIdentifier(expression)) return [expression.text]

  if (expression.kind === ts.SyntaxKind.ThisKeyword) return ['this']

  if (ts.isPropertyAccessExpression(expression))
    return [...calleeNames(expression.expression), expression.name.text]

  if (ts.isCallExpression(expression))
    return calleeNames(
      ts.isPropertyAccessExpression(expression.expression)
        ? expression.expression.expression
        : expression.expression,
    )

  if (
    ts.isParenthesizedExpression(expression) ||
    ts.isAwaitExpression(expression) ||
    ts.isNonNullExpression(expression)
  )
    return calleeNames(expression.expression)

  return []
}

/**
 * Whether a call such as `ctx.bouncer.with(Policy).authorize()` is the one an `errors.throwers`
 * key such as `bouncer.authorize` names.
 */
export function callMatches(call: ts.CallExpression, key: string) {
  const names = calleeNames(call.expression)
  const wanted = key.split('.')

  return (
    names.length >= wanted.length &&
    wanted.every((name, index) => names[names.length - wanted.length + index] === name)
  )
}
