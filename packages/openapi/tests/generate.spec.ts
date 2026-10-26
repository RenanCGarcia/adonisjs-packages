import { execFile } from 'node:child_process'
import { readFile, rm } from 'node:fs/promises'
import { promisify } from 'node:util'
import { test } from '@japa/runner'
import type { OpenApiDocument } from '../src/types.ts'

const playground = new URL('../../../playground/', import.meta.url)
const output = 'tmp/openapi.spec.json'
const run = promisify(execFile)

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
    ])
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

  test('documents the status codes named by @throws', ({ assert }) => {
    assert.deepEqual(document.paths['/api/v1/users/{id}']!.get!.responses['404'], {
      description: 'User not found',
    })
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

  test('adds the 401 response to routes behind a security scheme', ({ assert }) => {
    assert.deepEqual(document.paths['/api/v1/account/profile']!.get!.responses['401'], {
      description: 'Unauthorized',
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

  test('documents each exception of a union @throws under its own status', ({ assert }) => {
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

  test('writes the tags from the config', ({ assert }) => {
    assert.deepEqual(document.tags, [{ name: 'Users', description: 'Public user profiles' }])
  })
})
