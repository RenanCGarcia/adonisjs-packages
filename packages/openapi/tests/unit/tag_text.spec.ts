import { test } from '@japa/runner'
import { reasonOf } from '../../src/analysis/tags/tag_text.ts'

test.group('reasonOf', () => {
  test('keeps a one-line reason as written', ({ assert }) => {
    assert.equal(reasonOf('Verify the email address first'), 'Verify the email address first')
  })

  test('joins the lines of a wrapped reason with a single space', ({ assert }) => {
    assert.equal(
      reasonOf('Verify the email\n   address\n\tfirst'),
      'Verify the email address first',
    )
  })

  test('trims the text around the reason', ({ assert }) => {
    assert.equal(reasonOf('  Forbidden \n'), 'Forbidden')
  })

  test('gives no reason for text with only whitespace', ({ assert }) => {
    assert.isUndefined(reasonOf(''))
    assert.isUndefined(reasonOf(' \n  \n'))
  })
})
