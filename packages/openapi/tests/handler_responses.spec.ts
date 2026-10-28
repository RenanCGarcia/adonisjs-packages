import { test } from '@japa/runner'
import type { OpenApiDocument } from '../src/types.ts'
import { generatePlayground, inline, json, object } from './support/playground.ts'

test.group('openapi:generate on the playground app: what a handler returns and sends', group => {
  let document: OpenApiDocument
  let logs: string

  group.setup(async () => {
    ;({ document, logs } = await generatePlayground())
  })

  const probe = (path: string, method: 'get' | 'post' = 'get') =>
    document.paths[`/api/v1/probe/${path}`]![method]!

  test('takes the status code from the response helper the handler returns', ({ assert }) => {
    const signup = document.paths['/api/v1/auth/signup']!.post!.responses

    assert.notProperty(signup, '200')
    assert.deepEqual(
      inline(signup['201']).content!['application/json']!.schema.properties!.data!.properties!.user,
      { $ref: '#/components/schemas/User' },
    )
    assert.deepEqual(document.paths['/api/v1/account/avatar']!.delete!.responses['204'], {
      description: 'No Content',
    })
  })

  test('adds the 401 response E_UNAUTHORIZED_ACCESS renders to routes behind a security scheme', ({
    assert,
  }) => {
    assert.deepEqual(
      json(document.paths['/api/v1/account/profile']!.get!.responses['401']),
      object({ errors: { type: 'array', items: object({ message: { type: 'string' } }) } }),
    )
    assert.notProperty(document.paths['/api/v1/auth/login']!.post!.responses, '401')
  })

  test('adds the 401 of auth.getUserOrFail() to a route without the auth middleware', ({
    assert,
  }) => {
    assert.deepEqual(
      json(probe('card').responses['401']),
      object({ errors: { type: 'array', items: object({ message: { type: 'string' } }) } }),
    )
  })

  test('merges the branches that answer with one status code', ({ assert }) => {
    const responses = probe('branches').responses

    assert.sameMembers(Object.keys(responses), ['200', '201'])
    assert.deepEqual(json(responses['200']).oneOf, [
      object({ data: object({ serialized: { type: 'number' } }) }),
      object({ plain: { type: 'string' } }),
    ])
  })

  test('answers 204 for null and marks a body that can be absent', ({ assert }) => {
    assert.deepEqual(probe('empty').responses, { '204': { description: 'No Content' } })
    assert.equal(inline(probe('maybe').responses['200']).description, 'OK, or no body')
    assert.deepEqual(json(probe('maybe').responses['200']), object({ found: { type: 'boolean' } }))
  })

  test('documents a redirect as 302 with a Location header', ({ assert }) => {
    assert.deepEqual(probe('back').responses, {
      '302': { description: 'Found', headers: { Location: { schema: { type: 'string' } } } },
    })
  })

  test('sends a string as text/plain unless the handler sets the content-type', ({ assert }) => {
    assert.deepEqual(inline(probe('text').responses['200']).content, {
      'text/plain': { schema: { type: 'string' } },
    })
    assert.deepEqual(inline(probe('csv').responses['200']).content, {
      'text/csv': { schema: { type: 'string' } },
    })
  })

  test('keeps the status set before json()', ({ assert }) => {
    const responses = probe('json-created', 'post').responses

    assert.sameMembers(Object.keys(responses), ['201'])
    assert.deepEqual(json(responses['201']), object({ id: { type: 'number' } }))
  })

  test('documents a handler that only answers with an error, with the headers it sets', ({
    assert,
  }) => {
    assert.deepEqual(probe('limited').responses, {
      '429': {
        description: 'Too Many Requests',
        headers: { 'Retry-After': { schema: { type: 'string' } } },
        content: { 'application/json': { schema: object({ message: { type: 'string' } }) } },
      },
    })
    assert.notInclude(logs, 'probe.probe.limited')
  })

  test('reads the response calls of the handler', ({ assert }) => {
    assert.deepEqual(
      json(probe('sent', 'post').responses['202']),
      object({ queued: { type: 'boolean' } }),
    )
    assert.sameMembers(Object.keys(probe('aborted').responses), ['403', '410'])
    assert.deepEqual(
      json(probe('aborted').responses['403']),
      object({ message: { type: 'string' } }),
    )
  })

  test('documents files and streams as binary', ({ assert }) => {
    const binary = { 'application/octet-stream': { schema: { type: 'string', format: 'binary' } } }

    assert.deepEqual(inline(probe('download').responses['200']).content, binary)
    assert.deepEqual(inline(probe('report').responses['200']).content, {
      'application/pdf': { schema: { type: 'string', format: 'binary' } },
    })
    assert.deepEqual(inline(probe('export').responses['200']).content, {
      'text/csv': { schema: { type: 'string', format: 'binary' } },
    })
    assert.deepEqual(inline(probe('stream').responses['200']).content, binary)
    assert.deepEqual(probe('attachment').responses['200'], {
      description: 'OK',
      headers: { 'Content-Disposition': { schema: { type: 'string' } } },
      content: binary,
    })
  })
})
