import { test } from '@japa/runner'
import type { OpenApiDocument } from '../src/types.ts'
import { generatePlayground, inline, json, object } from './support/playground.ts'

test.group('openapi:generate on the playground app: the document', group => {
  let document: OpenApiDocument
  let logs: string

  group.setup(async () => {
    ;({ document, logs } = await generatePlayground())
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
      '/api/v1/cart',
      '/api/v1/forms/posts',
      '/oauth/github/redirect',
      '/oauth/github/callback',
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
      '/api/v1/probe/report',
      '/api/v1/probe/export',
      '/api/v1/probe/stream',
      '/api/v1/probe/thrown',
      '/api/v1/probe/verified',
      '/api/v1/probe/gated',
      '/api/v1/probe/reasoned',
      '/api/v1/probe/authorized',
      '/api/v1/probe/screened',
      '/api/v1/probe/managed',
      '/api/v1/probe/viewed',
      '/api/v1/probe/hidden',
      '/api/v1/probe/users/{id}',
      '/api/v1/probe/plan',
      '/api/v1/probe/seats',
      '/api/v1/probe/maintenance',
      '/api/v1/probe/upstream',
      '/api/v1/probe/throttled',
      '/api/v1/probe/card',
      '/api/v1/probe/whoami',
      '/api/v1/probe/model',
      '/api/v1/probe/collections',
      '/api/v1/probe/search',
      '/api/v1/probe/items',
      '/api/v1/probe/items/{id}',
      '/api/v1/probe/echo',
      '/api/v1/probe/paged',
      '/api/v1/probe/nullable',
      '/api/v1/probe/secret',
    ])
    assert.include(logs, 'OA-R001 probe.closure: closure handlers have no types to read')
    assert.notInclude(logs, 'openapi.ui')
  })

  test('takes body constraints from the VineJS validator', ({ assert }) => {
    const body =
      document.paths['/api/v1/auth/signup']!.post!.requestBody!.content['application/json']!.schema

    assert.deepEqual(body.properties!.email, { type: 'string', format: 'email', maxLength: 254 })
    assert.deepEqual(body.properties!.password, { type: 'string', minLength: 8, maxLength: 32 })
    assert.sameMembers(body.required ?? [], [
      'fullName',
      'email',
      'password',
      'passwordConfirmation',
    ])
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
    const schema = inline(document.paths['/api/v1/account/profile']!.get!.responses['200'])
      .content!['application/json']!.schema

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
    assert.deepEqual(document.paths['/api/v1/account/profile']!.get!.tags, ['Account'])
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

  test('names transformer data as components and references them', ({ assert }) => {
    const json = (path: string) =>
      inline(document.paths[path]!.get!.responses['200']).content!['application/json']!.schema

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
      inline(document.paths['/api/v1/auth/login']!.post!.responses['422']).content![
        'application/json'
      ]!.schema,
      { $ref: '#/components/schemas/ValidationError' },
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
    assert.deepEqual(
      document.tags?.map(({ name }) => name),
      ['Auth', 'Account', 'Users', 'Directory', 'Webhooks', 'Session', 'Forms', 'OAuth', 'Probe'],
    )
  })

  test('tags an operation with the @tags of its controller class, not its route name', ({
    assert,
  }) => {
    assert.deepEqual(document.paths['/api/v1/account/logout']!.post!.tags, ['Auth'])
  })
})
