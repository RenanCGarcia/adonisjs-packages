import { test } from '@japa/runner'
import type { OpenApiDocument } from '../src/types.ts'
import { generatePlayground, json, object } from './support/playground.ts'

const found = { description: 'Found', headers: { Location: { schema: { type: 'string' } } } }

test.group('openapi:generate on the playground app: session, shield, ally and i18n', group => {
  let document: OpenApiDocument
  let logs: string

  group.setup(async () => {
    ;({ document, logs } = await generatePlayground())
  })

  test('documents a flash and redirect().back() as a 302', ({ assert }) => {
    assert.deepEqual(document.paths['/api/v1/cart']!.post!.responses, { '302': found })
  })

  test('documents a form route behind CSRF with its redirect and its validation error', ({
    assert,
  }) => {
    const responses = document.paths['/api/v1/forms/posts']!.post!.responses

    assert.sameMembers(Object.keys(responses), ['302', '422'])
    assert.deepEqual(json(responses['422']), { $ref: '#/components/schemas/ValidationError' })
  })

  test('documents the redirect of an Ally driver as a 302', ({ assert }) => {
    assert.deepEqual(document.paths['/oauth/github/redirect']!.get!.responses, { '302': found })
    assert.notInclude(logs, 'github.redirect')
  })

  test('gives an Ally exception the body its own handle() sends', ({ assert }) => {
    assert.deepEqual(
      json(document.paths['/oauth/github/callback']!.get!.responses['400']),
      object({ errors: { type: 'array', items: object({ message: { type: 'string' } }) } }),
    )
    assert.notInclude(logs, 'OA-E002')
  })
})
