import ts from 'typescript'
import { test } from '@japa/runner'
import { instanceofClasses } from '../src/analysis/exceptions/exception_handler.ts'

const classes = (condition: string) => {
  const source = ts.createSourceFile('condition.ts', `(${condition})`, ts.ScriptTarget.Latest, true)
  const [statement] = source.statements

  if (!statement || !ts.isExpressionStatement(statement)) throw new Error('not an expression')

  return instanceofClasses(statement.expression)?.map(({ name, fallsThrough }) => ({
    name: name.getText(source),
    fallsThrough,
  }))
}

test.group('instanceofClasses', () => {
  test('lets only the class under an && fall through', ({ assert }) => {
    assert.deepEqual(classes(`(error instanceof A && error.code === 'X') || error instanceof B`), [
      { name: 'A', fallsThrough: true },
      { name: 'B', fallsThrough: false },
    ])
  })

  test('names no class when one side of an || checks something else', ({ assert }) => {
    assert.isUndefined(classes(`error instanceof A || error.code === 'X'`))
  })
})
