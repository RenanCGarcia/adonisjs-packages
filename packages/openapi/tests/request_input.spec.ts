import { test } from '@japa/runner'
import type { OpenApiDocument } from '../src/types.ts'
import { body, generatePlayground, json, object } from './support/playground.ts'

test.group('openapi:generate on the playground app: the request input', group => {
  let document: OpenApiDocument

  group.setup(async () => {
    ;({ document } = await generatePlayground())
  })

  test('documents a validator query object as a body field, not as query params', ({ assert }) => {
    const paged = document.paths['/api/v1/probe/paged']!.post!

    assert.isUndefined(paged.parameters)
    assert.deepEqual(body(document, paged), object({ query: object({ page: { type: 'number' } }) }))
    assert.deepEqual(
      json(paged.responses['200']),
      object({ query: object({ page: { type: 'number' } }) }),
    )
  })

  test('requires a nullable field, which the body must send even as null', ({ assert }) => {
    const nullable = document.paths['/api/v1/probe/nullable']!.post!

    assert.deepEqual(body(document, nullable), {
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

  test('lists a validated body under one media type per bodyparser parser', ({ assert }) => {
    const nullable = document.paths['/api/v1/probe/nullable']!.post!

    assert.deepEqual(Object.keys(nullable.requestBody!.content), [
      'application/json',
      'application/x-www-form-urlencoded',
      'multipart/form-data',
    ])
  })

  test('references one schema from every media type of a body', ({ assert }) => {
    const { content } = document.paths['/api/v1/probe/nullable']!.post!.requestBody!

    for (const media of Object.values(content))
      assert.deepEqual(media.schema, { $ref: '#/components/schemas/probe.probe.nullable.body' })
  })
})
