import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from '@japa/runner'
import type { OpenApiDocument } from '../src/types.ts'
import { playground, run } from './support/playground.ts'

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
