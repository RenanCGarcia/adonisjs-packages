import { test } from '@japa/runner'
import type ts from 'typescript'
import type { ResponseTag } from '../../src/analysis/tags/response_tag.ts'
import { applicable } from '../../src/document/responses/from_tags.ts'

// SAFETY: `applicable` only checks whether `body` is set, and never reads the type or the tag.
const body = {} as ts.Type

// SAFETY: as above.
const anyTag = {} as ts.JSDocTag

const declares = (code: string): ResponseTag => ({ code, body, tag: anyTag })

const describes = (code: string, reason: string): ResponseTag => ({
  code,
  reason,
  tag: anyTag,
})

test.group('applicable', () => {
  test('applies a tag with a body whatever the other sources document', ({ assert }) => {
    const declared = declares('502')

    assert.deepEqual(
      applicable([declared], () => false),
      { apply: [declared], underived: [] },
    )
  })

  test('applies a reason for a status another source documents', ({ assert }) => {
    const tag = describes('404', 'No such user')

    assert.deepEqual(
      applicable([tag], code => code === '404'),
      { apply: [tag], underived: [] },
    )
  })

  test('applies a reason for a status a tag with a body declares', ({ assert }) => {
    const declared = declares('502')
    const reason = describes('502', 'The upstream is down')

    assert.deepEqual(
      applicable([reason, declared], () => false),
      { apply: [declared, reason], underived: [] },
    )
  })

  test('leaves out a reason for a status nothing documents', ({ assert }) => {
    const reason = describes('418', 'Short and stout')

    assert.deepEqual(
      applicable([reason], () => false),
      { apply: [], underived: [reason] },
    )
  })

  test('puts the declared bodies first', ({ assert }) => {
    const reason = describes('404', 'No such user')
    const declared = declares('502')

    assert.deepEqual(applicable([reason, declared], code => code === '404').apply, [
      declared,
      reason,
    ])
  })
})
