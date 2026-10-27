import { execFile } from 'node:child_process'
import { readFile, rm } from 'node:fs/promises'
import { promisify } from 'node:util'
import { test } from '@japa/runner'
import type { JsonSchema, OpenApiDocument, OpenApiResponse } from '../src/types.ts'

const playground = new URL('../../../playground/', import.meta.url)
const output = 'tmp/openapi.spec.json'
const run = promisify(execFile)

const json = (response: OpenApiResponse | undefined) =>
  response!.content!['application/json']!.schema

const object = (properties: Record<string, JsonSchema>): JsonSchema => ({
  type: 'object',
  properties,
  additionalProperties: false,
  required: Object.keys(properties),
})

test.group('openapi:generate on the playground app', group => {
  let document: OpenApiDocument
  let logs: string

  group.setup(async () => {
    await run('node', ['ace', 'codegen'], { cwd: playground })
    ;({ stdout: logs } = await run('node', ['ace', 'openapi:generate', `--output=${output}`], {
      cwd: playground,
    }))
    document = JSON.parse(await readFile(new URL(output, playground), 'utf8'))

    return () => rm(new URL(output, playground))
  })

  const probe = (path: string, method: 'get' | 'post' = 'get') =>
    document.paths[`/api/v1/probe/${path}`]![method]!

  test('documents every named route and skips closures', ({ assert }) => {
    assert.equal(document.openapi, '3.1.0')
    assert.sameMembers(Object.keys(document.paths), [
      '/api/v1/auth/signup',
      '/api/v1/auth/login',
      '/api/v1/account/profile',
      '/api/v1/account/logout',
      '/api/v1/account/avatar',
      '/api/v1/users',
      '/api/v1/users/{id}',
      '/api/v1/webhooks/mail',
      '/api/v1/probe/branches',
      '/api/v1/probe/empty',
      '/api/v1/probe/maybe',
      '/api/v1/probe/back',
      '/api/v1/probe/text',
      '/api/v1/probe/csv',
      '/api/v1/probe/json-created',
      '/api/v1/probe/limited',
      '/api/v1/probe/sent',
      '/api/v1/probe/aborted',
      '/api/v1/probe/download',
      '/api/v1/probe/attachment',
      '/api/v1/probe/stream',
      '/api/v1/probe/thrown',
      '/api/v1/probe/verified',
      '/api/v1/probe/model',
      '/api/v1/probe/collections',
      '/api/v1/probe/search',
      '/api/v1/probe/items',
      '/api/v1/probe/items/{id}',
      '/api/v1/probe/echo',
    ])
    assert.include(logs, 'probe.closure: closure handlers have no types to read')
    assert.notInclude(logs, 'openapi.ui')
  })

  test('takes body constraints from the VineJS validator', ({ assert }) => {
    const body =
      document.paths['/api/v1/auth/signup']!.post!.requestBody!.content['application/json']!.schema

    assert.deepEqual(body.properties!.email, { type: 'string', format: 'email', maxLength: 254 })
    assert.deepEqual(body.properties!.password, { type: 'string', minLength: 8, maxLength: 32 })
    assert.sameMembers(body.required ?? [], ['email', 'password', 'passwordConfirmation'])
  })

  test('sends files as multipart binary', ({ assert }) => {
    const content = document.paths['/api/v1/account/avatar']!.put!.requestBody!.content

    assert.deepEqual(Object.keys(content), ['multipart/form-data'])
    assert.deepEqual(content['multipart/form-data']!.schema.properties!.avatar, {
      type: 'string',
      format: 'binary',
    })
  })

  test('types path params from the validator and GET input as query params', ({ assert }) => {
    assert.deepEqual(document.paths['/api/v1/users/{id}']!.get!.parameters, [
      { name: 'id', in: 'path', required: true, schema: { type: 'integer', minimum: 1 } },
    ])
    assert.deepEqual(document.paths['/api/v1/users']!.get!.parameters, [
      { name: 'page', in: 'query', required: false, schema: { type: 'integer', minimum: 1 } },
      {
        name: 'perPage',
        in: 'query',
        required: false,
        schema: { type: 'integer', minimum: 1, maximum: 100 },
      },
    ])
  })

  test('derives the response from the serialized transformer', ({ assert }) => {
    const schema =
      document.paths['/api/v1/account/profile']!.get!.responses['200']!.content![
        'application/json'
      ]!.schema

    assert.deepEqual(schema.properties!.data, { $ref: '#/components/schemas/User' })
    assert.containsSubset(document.components.schemas.User!.properties, {
      email: { type: 'string' },
      id: { type: 'number' },
    })
  })

  test('adds the 422 response only to validated routes', ({ assert }) => {
    assert.property(document.paths['/api/v1/auth/login']!.post!.responses, '422')
    assert.notProperty(document.paths['/api/v1/account/profile']!.get!.responses, '422')
  })

  test('maps the auth middleware to its security scheme', ({ assert }) => {
    assert.deepEqual(document.paths['/api/v1/account/profile']!.get!.security, [
      { accessToken: [] },
    ])
    assert.isUndefined(document.paths['/api/v1/auth/login']!.post!.security)
  })

  test('requires the schemes of every mapped middleware together', ({ assert }) => {
    assert.deepEqual(document.paths['/api/v1/account/avatar']!.put!.security, [
      { accessToken: [], tenant: [] },
    ])
  })

  test('reads the summary, description and deprecation from the handler doc comment', ({
    assert,
  }) => {
    assert.containsSubset(document.paths['/api/v1/users/{id}']!.get, {
      summary: 'Show a user',
      description: 'Looks the user up by its numeric id.',
    })
    assert.isUndefined(document.paths['/api/v1/users/{id}']!.get!.deprecated)
    assert.isTrue(document.paths['/api/v1/users']!.get!.deprecated)
  })

  test('takes tags from the controller doc comment unless the handler sets its own', ({
    assert,
  }) => {
    assert.deepEqual(document.paths['/api/v1/users/{id}']!.get!.tags, ['Users'])
    assert.deepEqual(document.paths['/api/v1/users']!.get!.tags, ['Directory'])
    assert.deepEqual(document.paths['/api/v1/account/profile']!.get!.tags, ['profile'])
  })

  test('documents the status codes named by @throws with the exception handler body', ({
    assert,
  }) => {
    assert.deepEqual(document.paths['/api/v1/users/{id}']!.get!.responses['404'], {
      description: 'User not found',
      content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } },
    })
    assert.deepEqual(document.components.schemas.Error, {
      type: 'object',
      properties: { code: { type: 'string' }, message: { type: 'string' } },
      required: ['code', 'message'],
      additionalProperties: false,
    })
  })

  test('documents what a route middleware answers with', ({ assert }) => {
    assert.deepEqual(document.paths['/api/v1/account/avatar']!.put!.responses['400'], {
      description: 'Bad Request',
      content: {
        'application/json': {
          schema: {
            type: 'object',
            properties: {
              code: { type: 'string', const: 'E_INVALID_TENANT_HEADER' },
              message: { type: 'string' },
            },
            required: ['code', 'message'],
            additionalProperties: false,
          },
        },
      },
    })
    assert.notProperty(document.paths['/api/v1/account/profile']!.get!.responses, '400')
  })

  test('documents the status and body of an exception named by @throws', ({ assert }) => {
    const unprocessable = document.paths['/api/v1/auth/signup']!.post!.responses['422']!

    assert.equal(unprocessable.description, 'Unprocessable Entity')
    assert.deepEqual(unprocessable.content!['application/json']!.schema.oneOf, [
      {
        type: 'object',
        properties: {
          code: { type: 'string', const: 'E_DISPOSABLE_EMAIL' },
          message: { type: 'string' },
          domain: { type: 'string' },
        },
        required: ['code', 'message', 'domain'],
        additionalProperties: false,
      },
      { $ref: '#/components/schemas/ValidationError' },
    ])
  })

  test('takes the request body of an unvalidated handler from @requestBody', ({ assert }) => {
    assert.deepEqual(document.paths['/api/v1/webhooks/mail']!.post!.requestBody, {
      required: true,
      content: {
        'application/json': {
          schema: {
            type: 'object',
            properties: {
              type: { type: 'string', enum: ['delivered', 'bounced'] },
              messageId: { type: 'string' },
              occurredAt: { type: 'string' },
            },
            required: ['type', 'messageId', 'occurredAt'],
            additionalProperties: false,
          },
        },
      },
    })
  })

  test('takes the status code from the response helper the handler returns', ({ assert }) => {
    const signup = document.paths['/api/v1/auth/signup']!.post!.responses

    assert.notProperty(signup, '200')
    assert.deepEqual(
      signup['201']!.content!['application/json']!.schema.properties!.data!.properties!.user,
      { $ref: '#/components/schemas/User' },
    )
    assert.deepEqual(document.paths['/api/v1/account/avatar']!.delete!.responses['204'], {
      description: 'No Content',
    })
  })

  test('adds the 401 response E_UNAUTHORIZED_ACCESS renders to routes behind a security scheme', ({
    assert,
  }) => {
    assert.deepEqual(document.paths['/api/v1/account/profile']!.get!.responses['401'], {
      description: 'Unauthorized',
      content: {
        'application/json': {
          schema: {
            type: 'object',
            properties: {
              errors: {
                type: 'array',
                items: {
                  type: 'object',
                  properties: { message: { type: 'string' } },
                  additionalProperties: false,
                  required: ['message'],
                },
              },
            },
            additionalProperties: false,
            required: ['errors'],
          },
        },
      },
    })
    assert.notProperty(document.paths['/api/v1/auth/login']!.post!.responses, '401')
  })

  test('names transformer data as components and references them', ({ assert }) => {
    const json = (path: string) =>
      document.paths[path]!.get!.responses['200']!.content!['application/json']!.schema

    assert.deepEqual(json('/api/v1/users/{id}').properties!.data, {
      $ref: '#/components/schemas/User',
    })
    assert.deepEqual(json('/api/v1/users').properties!.data, {
      type: 'array',
      items: { $ref: '#/components/schemas/User' },
    })
  })

  test('names the validation error as a shared component', ({ assert }) => {
    assert.property(document.components.schemas, 'ValidationError')
    assert.deepEqual(
      document.paths['/api/v1/auth/login']!.post!.responses['422']!.content!['application/json']!
        .schema,
      { $ref: '#/components/schemas/ValidationError' },
    )
  })

  test('documents each exception of a union @throws under its own status, also when named by import()', ({
    assert,
  }) => {
    const conflict = document.paths['/api/v1/auth/signup']!.post!.responses['409']!

    assert.deepEqual(conflict.content!['application/json']!.schema, {
      type: 'object',
      properties: {
        code: { type: 'string', const: 'E_EMAIL_TAKEN' },
        message: { type: 'string' },
      },
      required: ['code', 'message'],
      additionalProperties: false,
    })
  })

  test('reads the response helper an exception answers with in its handle()', ({ assert }) => {
    assert.notInclude(logs, '@throws')
    assert.property(document.paths['/api/v1/auth/signup']!.post!.responses, '409')
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
    assert.equal(probe('maybe').responses['200']!.description, 'OK, or no body')
    assert.deepEqual(json(probe('maybe').responses['200']), object({ found: { type: 'boolean' } }))
  })

  test('documents a redirect as 302 with a Location header', ({ assert }) => {
    assert.deepEqual(probe('back').responses, {
      '302': { description: 'Found', headers: { Location: { schema: { type: 'string' } } } },
    })
  })

  test('sends a string as text/plain unless the handler sets the content-type', ({ assert }) => {
    assert.deepEqual(probe('text').responses['200']!.content, {
      'text/plain': { schema: { type: 'string' } },
    })
    assert.deepEqual(probe('csv').responses['200']!.content, {
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

    assert.deepEqual(probe('download').responses['200']!.content, binary)
    assert.deepEqual(probe('stream').responses['200']!.content, binary)
    assert.deepEqual(probe('attachment').responses['200'], {
      description: 'OK',
      headers: { 'Content-Disposition': { schema: { type: 'string' } } },
      content: binary,
    })
  })

  test('documents the exceptions the handler and its middleware throw', ({ assert }) => {
    assert.deepEqual(
      json(probe('thrown').responses['409']),
      object({ code: { type: 'string', const: 'E_EMAIL_TAKEN' }, message: { type: 'string' } }),
    )
    assert.deepEqual(
      json(probe('verified').responses['403']),
      object({
        code: { type: 'string', const: 'E_EMAIL_NOT_VERIFIED' },
        message: { type: 'string' },
      }),
    )
  })

  test('emits {} and a warning for a Lucid model', ({ assert }) => {
    assert.deepEqual(json(probe('model').responses['200']), {})
    assert.include(logs, 'User is a Lucid model')
  })

  test('documents Map and Set as empty objects and bigint as a string', ({ assert }) => {
    const empty = { type: 'object', properties: {}, additionalProperties: false }

    assert.deepEqual(
      json(probe('collections').responses['200']),
      object({ tags: empty, counts: empty, total: { type: 'string' } }),
    )
  })

  test('sends an object query param as a deepObject', ({ assert }) => {
    assert.containsSubset(probe('search').parameters, [
      { name: 'filter', in: 'query', style: 'deepObject', explode: true },
    ])
  })

  test('documents the path without an optional param', ({ assert }) => {
    assert.deepEqual(document.paths['/api/v1/probe/items/{id}']!.get!.parameters, [
      { name: 'id', in: 'path', required: true, schema: { type: 'string' } },
    ])
    assert.isUndefined(probe('items').parameters)
    assert.equal(probe('items').operationId, 'probe.probe.item.without_id')
  })

  test('reads the input of each method of a route on its own', ({ assert }) => {
    assert.deepEqual(probe('echo').parameters, [
      { name: 'message', in: 'query', required: true, schema: { type: 'string' } },
    ])
    assert.isUndefined(probe('echo').requestBody)
    assert.isUndefined(probe('echo', 'post').parameters)
    assert.deepEqual(
      probe('echo', 'post').requestBody!.content['application/json']!.schema.properties,
      { message: { type: 'string' } },
    )
  })

  test('writes the tags from the config', ({ assert }) => {
    assert.deepEqual(document.tags, [{ name: 'Users', description: 'Public user profiles' }])
  })
})
