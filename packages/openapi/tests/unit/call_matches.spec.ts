import { test } from '@japa/runner'
import ts from 'typescript'
import { callMatches } from '../../src/analysis/errors/throwers.ts'

function call(code: string) {
  const file = ts.createSourceFile('call.ts', code, ts.ScriptTarget.Latest, true)
  const statement = file.statements[0]

  if (
    !statement ||
    !ts.isExpressionStatement(statement) ||
    !ts.isCallExpression(statement.expression)
  )
    throw new Error(`expected a call expression, got ${code}`)

  return statement.expression
}

test.group('callMatches', () => {
  test('matches a call made through the key', ({ assert }) => {
    assert.isTrue(callMatches(call('bouncer.authorize()'), 'bouncer.authorize'))
  })

  test('matches the key at the end of a longer chain', ({ assert }) => {
    assert.isTrue(callMatches(call('ctx.bouncer.authorize()'), 'bouncer.authorize'))
    assert.isTrue(callMatches(call('this.ctx.bouncer.authorize()'), 'bouncer.authorize'))
  })

  test('sees through the calls in between', ({ assert }) => {
    assert.isTrue(callMatches(call('ctx.bouncer.with(Policy).authorize()'), 'bouncer.authorize'))
  })

  test('sees through await, parentheses and non-null assertions', ({ assert }) => {
    assert.isTrue(callMatches(call('(await ctx.bouncer)!.authorize()'), 'bouncer.authorize'))
  })

  test('matches a key of one name', ({ assert }) => {
    assert.isTrue(callMatches(call('abort()'), 'abort'))
    assert.isTrue(callMatches(call('ctx.abort()'), 'abort'))
  })

  test('rejects a call made through another name', ({ assert }) => {
    assert.isFalse(callMatches(call('ctx.bouncer.deny()'), 'bouncer.authorize'))
    assert.isFalse(callMatches(call('other.authorize()'), 'bouncer.authorize'))
  })

  test('rejects a callee shorter than the key', ({ assert }) => {
    assert.isFalse(callMatches(call('authorize()'), 'bouncer.authorize'))
  })

  test('rejects a callee that is not a name chain', ({ assert }) => {
    assert.isFalse(callMatches(call('(a || b)()'), 'b'))
  })
})
