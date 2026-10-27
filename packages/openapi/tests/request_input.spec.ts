import { test } from '@japa/runner'
import type { OpenApiDocument } from '../src/types.ts'
import { generatePlayground, json, object } from './support/playground.ts'

test.group('openapi:generate on the playground app: the request input', group => {
  let document: OpenApiDocument

  group.setup(async () => {
    ;({ document } = await generatePlayground())
  })

  test('documents a validator query object as a body field, not as query params', ({ assert }) => {
    const paged = document.paths['/api/v1/probe/paged']!.post!

    assert.isUndefined(paged.parameters)
    assert.deepEqual(
      paged.requestBody!.content['application/json']!.schema,
      object({ query: object({ page: { type: 'number' } }) }),
    )
    assert.deepEqual(
      json(paged.responses['200']),
      object({ query: object({ page: { type: 'number' } }) }),
    )
  })

  test('requires a nullable field, which the body must send even as null', ({ assert }) => {
    const nullable = document.paths['/api/v1/probe/nullable']!.post!

    assert.deepEqual(nullable.requestBody!.content['application/json']!.schema, {
      type: 'object',
      properties: {
        nickname: { type: ['string', 'null'] },
        bio: { type: 'string' },
        website: { type: ['string', 'null'] },
      },
      additionalProperties: false,
      required: ['nickname'],
    })
  })
})
