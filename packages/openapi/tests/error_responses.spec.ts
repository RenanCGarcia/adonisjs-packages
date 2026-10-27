import { test } from '@japa/runner'
import type { OpenApiDocument } from '../src/types.ts'
import { generatePlayground, inline, json, object, resolved } from './support/playground.ts'

const authorizationFailure = object({
  code: { type: 'string', const: 'E_AUTHORIZATION_FAILURE' },
  message: { type: 'string' },
})

const emailNotVerified = object({
  code: { type: 'string', const: 'E_EMAIL_NOT_VERIFIED' },
  message: { type: 'string' },
})

test.group('openapi:generate on the playground app: exceptions, middleware and tags', group => {
  let document: OpenApiDocument
  let logs: string

  group.setup(async () => {
    ;({ document, logs } = await generatePlayground())
  })

  const probe = (path: string, method: 'get' | 'post' = 'get') =>
    document.paths[`/api/v1/probe/${path}`]![method]!

  test('documents the 404 of findOrFail with the handler body, described by @response', ({
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
      $ref: '#/components/responses/TenantMiddleware',
    })
    assert.deepEqual(document.components.responses?.TenantMiddleware, {
      description: 'The X-Tenant-Id header is missing',
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

  test('documents what a function passed to .use() answers with', ({ assert }) => {
    assert.deepEqual(probe('secret').responses['401'], {
      description: 'Unauthorized',
      content: {
        'application/json': {
          schema: object({
            code: { type: 'string', const: 'E_WRONG_SECRET' },
            message: { type: 'string' },
          }),
        },
      },
    })
  })

  test('documents the status and body of an exception named by @throws', ({ assert }) => {
    const unprocessable = inline(document.paths['/api/v1/auth/signup']!.post!.responses['422'])

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

  test('resolves a @throws class by name without an import', ({ assert }) => {
    assert.notInclude(logs, 'OA-T002')

    const conflict = resolved(
      document,
      document.paths['/api/v1/auth/signup']!.post!.responses['409'],
    )

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

  test('documents the exceptions the handler and its middleware throw', ({ assert }) => {
    assert.deepEqual(
      json(probe('thrown').responses['409']),
      object({ code: { type: 'string', const: 'E_EMAIL_TAKEN' }, message: { type: 'string' } }),
    )
    assert.deepEqual(
      json(resolved(document, probe('verified').responses['403'])),
      object({
        code: { type: 'string', const: 'E_EMAIL_NOT_VERIFIED' },
        message: { type: 'string' },
      }),
    )
  })

  test('joins the bodies of the middleware and the action that answer with one status, and only those', ({
    assert,
  }) => {
    assert.deepEqual(json(probe('gated').responses['403']), {
      oneOf: [authorizationFailure, emailNotVerified],
    })
  })

  test('lists every literal code the app sends in a shared ErrorCode schema', ({ assert }) => {
    const { enum: codes = [] } = document.components.schemas.ErrorCode!

    assert.deepEqual(
      codes,
      [...codes].sort((a, b) => String(a).localeCompare(String(b))),
    )
    assert.includeMembers(codes, [
      'E_AUTHORIZATION_FAILURE',
      'E_EMAIL_NOT_VERIFIED',
      'E_EMAIL_TAKEN',
    ])
  })

  test('describes a thrown status with @response without adding a body', ({ assert }) => {
    assert.deepEqual(probe('thrown').responses['409'], {
      description: 'The email is taken',
      content: {
        'application/json': {
          schema: object({
            code: { type: 'string', const: 'E_EMAIL_TAKEN' },
            message: { type: 'string' },
          }),
        },
      },
    })
    assert.deepEqual(probe('reasoned').responses['403'], {
      description: 'Verify the email address first',
      content: { 'application/json': { schema: emailNotVerified } },
    })
  })

  test('documents the 403 bouncer.authorize() throws with the body of its handler branch', ({
    assert,
  }) => {
    for (const path of ['authorized', 'viewed'])
      assert.deepEqual(probe(path).responses['403'], {
        description: 'Forbidden',
        content: { 'application/json': { schema: authorizationFailure } },
      })

    assert.notProperty(probe('text').responses, '403')
    assert.notProperty(probe('thrown').responses, '403')
  })

  test('documents the status a policy denies with from @response {N} {Type}', ({ assert }) => {
    assert.deepEqual(probe('hidden').responses['404'], {
      description: 'The probe is hidden from guests',
      content: { 'application/json': { schema: authorizationFailure } },
    })
    assert.property(probe('hidden').responses, '403')
  })

  test('follows findOrFail into the app functions the action calls', ({ assert }) => {
    assert.deepEqual(probe('users/{id}').responses['404'], {
      description: 'Not Found',
      content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } },
    })
  })

  test('documents what a package middleware named in errors.middleware throws', ({ assert }) => {
    assert.deepEqual(
      json(probe('throttled').responses['429']),
      object({
        code: { type: 'string', const: 'E_TOO_MANY_REQUESTS' },
        message: { type: 'string' },
        retryAfter: { type: 'number' },
      }),
    )
  })

  test('declares a status body with @response {N} {Type}', ({ assert }) => {
    assert.deepEqual(probe('upstream').responses, {
      '502': {
        description: 'The mail provider did not answer',
        content: {
          'application/json': {
            schema: object({
              code: { type: 'string' },
              message: { type: 'string' },
              provider: { type: 'string' },
            }),
          },
        },
      },
    })
  })

  test('renders an exception without a body of its own as the handler does for its class', ({
    assert,
  }) => {
    const limit = object({
      code: { type: 'string' },
      message: { type: 'string' },
      upgradeUrl: { type: 'string' },
    })

    assert.deepEqual(json(probe('plan').responses['402']), limit)
    assert.deepEqual(json(probe('seats').responses['402']), limit)
  })

  test('falls through a handler branch that sends nothing', ({ assert }) => {
    assert.deepEqual(json(probe('maintenance').responses['503']), {
      $ref: '#/components/schemas/Error',
    })
    assert.deepEqual(
      document.components.schemas.Error,
      object({ code: { type: 'string' }, message: { type: 'string' } }),
    )
  })
})
