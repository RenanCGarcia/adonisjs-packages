import { execFile } from 'node:child_process'
import { cp, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import { test } from '@japa/runner'
import type { JsonSchema, OpenApiDocument, OpenApiResponse } from '../src/types.ts'

const playground = new URL('../../../playground/', import.meta.url)
const output = 'tmp/openapi.spec.json'
const golden = new URL('fixtures/playground.openapi.json', import.meta.url)
const brokenApp = new URL('fixtures/broken_app/', import.meta.url)
const unauthorizedApp = new URL('fixtures/unauthorized_app/', import.meta.url)
const run = promisify(execFile)

const json = (response: OpenApiResponse | undefined) =>
  response!.content!['application/json']!.schema

const object = (properties: Record<string, JsonSchema>): JsonSchema => ({
  type: 'object',
  properties,
  additionalProperties: false,
  required: Object.keys(properties),
})

const authorizationFailure = object({
  code: { type: 'string', const: 'E_AUTHORIZATION_FAILURE' },
  message: { type: 'string' },
})

const emailNotVerified = object({
  code: { type: 'string', const: 'E_EMAIL_NOT_VERIFIED' },
  message: { type: 'string' },
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
      '/api/v1/probe/report',
      '/api/v1/probe/export',
      '/api/v1/probe/stream',
      '/api/v1/probe/thrown',
      '/api/v1/probe/verified',
      '/api/v1/probe/gated',
      '/api/v1/probe/reasoned',
      '/api/v1/probe/authorized',
      '/api/v1/probe/viewed',
      '/api/v1/probe/hidden',
      '/api/v1/probe/users/{id}',
      '/api/v1/probe/plan',
      '/api/v1/probe/seats',
      '/api/v1/probe/maintenance',
      '/api/v1/probe/upstream',
      '/api/v1/probe/throttled',
      '/api/v1/probe/model',
      '/api/v1/probe/collections',
      '/api/v1/probe/search',
      '/api/v1/probe/items',
      '/api/v1/probe/items/{id}',
      '/api/v1/probe/echo',
    ])
    assert.include(logs, 'OA-R001 probe.closure: closure handlers have no types to read')
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
    assert.deepEqual(
      json(document.paths['/api/v1/account/profile']!.get!.responses['401']),
      object({ errors: { type: 'array', items: object({ message: { type: 'string' } }) } }),
    )
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

  test('resolves a @throws class by name without an import', ({ assert }) => {
    assert.notInclude(logs, 'OA-T002')
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
    assert.deepEqual(probe('report').responses['200']!.content, {
      'application/pdf': { schema: { type: 'string', format: 'binary' } },
    })
    assert.deepEqual(probe('export').responses['200']!.content, {
      'text/csv': { schema: { type: 'string', format: 'binary' } },
    })
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

  test('joins the bodies of the middleware and the action that answer with one status, and only those', ({
    assert,
  }) => {
    assert.deepEqual(json(probe('gated').responses['403']), {
      oneOf: [authorizationFailure, emailNotVerified],
    })
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

  test('matches the committed playground document byte for byte', async ({ assert }) => {
    const generated = await readFile(new URL(output, playground), 'utf8')

    if (process.env.UPDATE_GOLDEN) await writeFile(golden, generated)

    assert.isTrue(
      generated === (await readFile(golden, 'utf8')),
      'The playground document differs from tests/fixtures/playground.openapi.json. If the change is intended, run `UPDATE_GOLDEN=1 pnpm test` in packages/openapi and explain the diff in the PR.',
    )
  })
})

test.group('openapi:generate --output', () => {
  test('writes an absolute path as given', async ({ assert }) => {
    const dir = await mkdtemp(join(tmpdir(), 'openapi-'))
    const file = join(dir, 'nested', 'openapi.json')

    try {
      const { stdout } = await run('node', ['ace', 'openapi:generate', `--output=${file}`], {
        cwd: playground,
      })

      assert.include(stdout, `OpenAPI document written to ${file}`)
      assert.equal(JSON.parse(await readFile(file, 'utf8')).openapi, '3.1.0')
    } finally {
      await rm(dir, { recursive: true })
    }
  })
})

test.group('openapi:generate --explain', () => {
  test('prints where each response of a route comes from', async ({ assert }) => {
    const { stdout } = await run(
      'node',
      ['ace', 'openapi:generate', '--explain=auth.new_account.store'],
      { cwd: playground },
    )

    assert.include(stdout, 'throw new EmailTakenException() (app/services/create_account.ts:')
    assert.include(stdout, 'a @throws tag (app/controllers/new_account_controller.ts:')
    assert.match(
      stdout,
      /409\n(?: {2}.+\n)*? {2}a @throws tag \(app\/controllers\/new_account_controller\.ts:\d+\)/,
    )
    assert.include(stdout, 'the validator rejects the input')
  })

  test('names the call and the package middleware an exception comes from', async ({ assert }) => {
    const gated = await run('node', ['ace', 'openapi:generate', '--explain=probe.probe.gated'], {
      cwd: playground,
    })

    const throttled = await run('node', ['ace', 'openapi:generate', '--explain=probe.throttled'], {
      cwd: playground,
    })

    assert.include(
      gated.stdout,
      'bouncer.authorize() throws E_AUTHORIZATION_FAILURE (app/controllers/probe_controller.ts:',
    )
    assert.include(throttled.stdout, 'the middleware globalThrottle (config/openapi.ts:')
  })

  test('names the middleware that secures a route', async ({ assert }) => {
    const { stdout } = await run(
      'node',
      ['ace', 'openapi:generate', '--explain=profile.profile.show'],
      { cwd: playground },
    )

    assert.include(stdout, 'the auth middleware secures the route')
  })

  test('fails on an unknown route', async ({ assert }) => {
    await assert.rejects(() =>
      run('node', ['ace', 'openapi:generate', '--explain=nope'], { cwd: playground }),
    )
  })
})

test.group('openapi:check', group => {
  const committed = new URL('openapi.json', playground)

  group.each.setup(async () => {
    await run('node', ['ace', 'openapi:generate'], { cwd: playground })
  })

  test('passes when the committed document is up to date', async ({ assert }) => {
    const { stdout } = await run('node', ['ace', 'openapi:check'], { cwd: playground })

    assert.include(stdout, 'openapi.json is up to date')
  })

  test('fails and names what differs when the document is out of date', async ({ assert }) => {
    const document: OpenApiDocument = JSON.parse(await readFile(committed, 'utf8'))
    document.info.version = '0.0.0'
    await writeFile(committed, `${JSON.stringify(document, null, 2)}\n`)

    const error = await run('node', ['ace', 'openapi:check'], { cwd: playground }).then(
      () => undefined,
      (failure: { stdout: string; stderr: string }) => failure,
    )

    assert.exists(error)
    assert.include(`${error!.stdout}${error!.stderr}`, '/info/version')
  })
})

/**
 * A copy of the playground with `overlay` laid over it, so the playground stays valid. Returns the
 * copy's directory and what `openapi:generate` printed.
 */
async function generateInCopy(overlay: (dir: string) => Promise<void>) {
  const source = fileURLToPath(playground)
  const dir = await mkdtemp(join(tmpdir(), 'openapi-copy-'))

  await cp(source, dir, {
    recursive: true,
    filter: path =>
      !/^(node_modules|tmp|build|\.adonisjs|openapi\.json)(\/|$)/.test(relative(source, path)),
  })
  await symlink(join(source, 'node_modules'), join(dir, 'node_modules'))
  await mkdir(join(dir, 'tmp'))
  await overlay(dir)
  await run('node', ['ace', 'codegen'], { cwd: dir })

  const result = await run('node', ['ace', 'openapi:generate'], { cwd: dir }).then(
    success => success,
    (error: { stdout: string; stderr: string }) => error,
  )

  return { dir, output: `${result.stdout}${result.stderr}` }
}

test.group('openapi:generate on an app whose handler renders E_UNAUTHORIZED_ACCESS', group => {
  let document: OpenApiDocument
  let dir: string

  group.setup(async () => {
    ;({ dir } = await generateInCopy(copy =>
      cp(fileURLToPath(unauthorizedApp), copy, { recursive: true }),
    ))
    document = JSON.parse(await readFile(join(dir, 'openapi.json'), 'utf8'))

    return () => rm(dir, { recursive: true })
  })

  test('documents the 401 of a secured route with the body of the handler branch', ({ assert }) => {
    assert.deepEqual(
      json(document.paths['/api/v1/account/profile']!.get!.responses['401']),
      object({
        code: { type: 'string', const: 'E_UNAUTHORIZED_ACCESS' },
        message: { type: 'string' },
      }),
    )
  })
})

test.group('openapi:generate on an app whose tags are wrong', group => {
  let output: string
  let dir: string

  group.setup(async () => {
    ;({ dir, output } = await generateInCopy(copy =>
      cp(fileURLToPath(brokenApp), copy, { recursive: true }),
    ))

    return () => rm(dir, { recursive: true })
  })

  test('fails and writes no document', async ({ assert }) => {
    assert.include(output, 'The errors above block the document')
    await assert.rejects(() => readFile(join(dir, 'openapi.json')))
  })

  test('rejects a numeric @throws and a union with the fix', ({ assert }) => {
    assert.include(
      output,
      'OA-T001 broken.numeric: @throws: 404 names a status code, not an exception class: use `@response {404} reason` to describe a derived status, `@response {404} {Type}` to declare a body, or `@throws {Class}`',
    )
    assert.include(
      output,
      'OA-T001 broken.union: @throws: PlanLimitException | MaintenanceException names several classes: write one @throws tag per class',
    )
  })

  test('rejects a @throws without braces with the fix', ({ assert }) => {
    assert.include(
      output,
      'OA-T001 broken.unbraced: @throws EmailTakenException has no braces around the class: write it as `@throws {EmailTakenException} reason`',
    )
    assert.include(
      output,
      'OA-T001 broken.unbraced_status: @throws 404 names a status code, not an exception class: use `@response {404} reason`',
    )
  })

  test('lists the candidates of a @throws class name that resolves to none or several', ({
    assert,
  }) => {
    assert.include(
      output,
      'OA-T002 broken.duplicate: @throws: LimitException: several exception classes are named LimitException: app/exceptions/billing/limit_exception.ts, app/exceptions/storage/limit_exception.ts',
    )
    assert.include(
      output,
      'OA-T002 broken.missing: @throws: QuotaException: no exception class of the app is named QuotaException',
    )
    assert.notInclude(output, 'broken.escaped')
  })

  test('rejects a @response reason for a status nothing documents', ({ assert }) => {
    assert.include(output, 'OA-T003 broken.underived: @response {418}: nothing documents a 418')
  })

  test('rejects a @response type it cannot read', ({ assert }) => {
    const errors = output.split('\n').filter(line => line.includes('[ error ]'))

    assert.isTrue(
      errors.some(line =>
        line.includes(
          'OA-T007 broken.inline: @response {502} {{ provider: string }}: an inline object type is not read: declare it as a type, such as `type Body = { provider: string }`, and write `@response {502} {Body}`',
        ),
      ),
    )
    assert.isTrue(
      errors.some(line =>
        line.includes(
          'OA-T007 broken.unresolved: @response {UpstreamFailure}: UpstreamFailure is not in scope',
        ),
      ),
    )
  })

  test('warns about a tag the generator does not read', ({ assert }) => {
    assert.include(output, 'OA-T008 broken.misspelled: @reponse is not a tag the generator reads')
    assert.include(
      output,
      'OA-T008 broken.annotated: @summary is not a tag the generator reads: the first paragraph of the comment is the summary',
    )
    assert.notInclude(output, 'OA-T008 broken.annotated: @internal')
    assert.notInclude(output, 'OA-T008 broken.annotated: @todo')
  })

  test('warns that a package exception renders a body its declaration does not carry', ({
    assert,
  }) => {
    assert.include(output, 'OA-E002 E_INVALID_CREDENTIALS renders its own body')
  })

  test('reads the status of an errors entry without running its class', ({ assert }) => {
    assert.notInclude(output, 'LedgerException constructed')
    assert.notInclude(output, "errors.throwers['ledger.reject']")
    assert.notInclude(output, "errors.throwers['verifyCredentials']")
  })

  test('warns about an errors key that matches nothing', ({ assert }) => {
    assert.include(
      output,
      "OA-E003 errors.throwers['bouncer.authorise'] matches no call of the documented routes",
    )
    assert.include(
      output,
      "OA-E003 errors.middleware['#start/limiter'] matches no middleware of the documented routes: name the middleware as `node ace list:routes` shows it",
    )
  })
})

test.group('defineConfig', () => {
  test('rejects the removed errorResponse option', async ({ assert }) => {
    const { defineConfig } = await import('../src/define_config.ts')

    assert.throws(
      // SAFETY: a JavaScript config has no types to reject the removed option, which is what this checks.
      () => defineConfig({ errorResponse: 'ApiError' } as never),
      'openapi: "errorResponse" is removed, set the error body type in "errors.body"',
    )
  })
})
