import { readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { test } from '@japa/runner'
import type { OpenApiDocument } from '../src/types.ts'
import { copyPlayground, playground, run } from './support/playground.ts'

test.group('node ace build', () => {
  test('ships the document at output with the build, without failing on a warning in strict', async ({
    assert,
  }) => {
    const dir = await copyPlayground(async copy => {
      const config = join(copy, 'config/openapi.ts')
      const source = await readFile(config, 'utf8')

      await writeFile(config, source.replace("output: 'openapi.json',", '$&\n  strict: true,'))
    })

    assert.include(await readFile(join(dir, 'config/openapi.ts'), 'utf8'), 'strict: true')

    await run('node', ['ace', 'build'], { cwd: dir })

    assert.deepEqual(
      JSON.parse(await readFile(join(dir, 'build/openapi.json'), 'utf8')),
      JSON.parse(await readFile(join(dir, 'openapi.json'), 'utf8')),
    )
  })
})

test.group('openapi:generate --strict', () => {
  test('writes no document when the app has a warning', async ({ assert }) => {
    const dir = await copyPlayground(copy => writeFile(join(copy, 'openapi.json'), '{}'))

    const error = await run('node', ['ace', 'openapi:generate', '--strict'], { cwd: dir }).then(
      () => undefined,
      (failure: { stdout: string; stderr: string }) => failure,
    )

    assert.exists(error)
    assert.include(`${error!.stdout}${error!.stderr}`, 'The errors above block the document')
    assert.equal(await readFile(join(dir, 'openapi.json'), 'utf8'), '{}')
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
    assert.notInclude(`${throttled.stdout}${throttled.stderr}`, 'OA-R003 probe.throttled')
  })

  test('names a function passed to .use() as closure', async ({ assert }) => {
    const { stdout } = await run('node', ['ace', 'openapi:generate', '--explain=probe.secret'], {
      cwd: playground,
    })

    assert.match(stdout, /401\n {2}the middleware closure \(start\/routes\.ts:\d+\)/)
  })

  test('names the middleware that secures a route', async ({ assert }) => {
    const { stdout } = await run(
      'node',
      ['ace', 'openapi:generate', '--explain=profile.profile.show'],
      { cwd: playground },
    )

    assert.include(stdout, 'the auth middleware secures the route')
  })

  test('does not fail on a warning with --strict, as it writes no file', async ({ assert }) => {
    const { stdout } = await run(
      'node',
      ['ace', 'openapi:generate', '--explain=probe.secret', '--strict'],
      { cwd: playground },
    )

    assert.include(stdout, '[ warn ] OA-R001 probe.closure')
  })

  test('fails on an unknown route', async ({ assert }) => {
    await assert.rejects(() =>
      run('node', ['ace', 'openapi:generate', '--explain=nope'], { cwd: playground }),
    )
  })
})

test.group('openapi:check', group => {
  let dir: string
  let committed: string

  group.setup(async () => {
    dir = await copyPlayground(async () => {})
    committed = join(dir, 'openapi.json')
  })

  group.each.setup(async () => {
    await run('node', ['ace', 'openapi:generate'], { cwd: dir })
  })

  test('passes when the committed document is up to date', async ({ assert }) => {
    const { stdout } = await run('node', ['ace', 'openapi:check'], { cwd: dir })

    assert.include(stdout, 'openapi.json is up to date')
  })

  test('fails on the warnings of the playground with --strict only', async ({ assert }) => {
    const { stdout } = await run('node', ['ace', 'openapi:check'], { cwd: dir })

    const error = await run('node', ['ace', 'openapi:check', '--strict'], { cwd: dir }).then(
      () => undefined,
      (failure: { stdout: string; stderr: string }) => failure,
    )

    assert.include(stdout, 'OA-R001 probe.closure')
    assert.exists(error)
    assert.include(`${error!.stdout}${error!.stderr}`, '[ error ] OA-R001 probe.closure')
    assert.include(`${error!.stdout}${error!.stderr}`, 'The errors above fail the check')
  })

  test('writes no file', async ({ assert }) => {
    const before = await readFile(committed, 'utf8')
    const document: OpenApiDocument = JSON.parse(before)
    document.info.version = '0.0.0'
    await writeFile(committed, JSON.stringify(document))

    await run('node', ['ace', 'openapi:check'], { cwd: dir }).catch(() => undefined)

    assert.equal(await readFile(committed, 'utf8'), JSON.stringify(document))
  })

  test('fails on a missing, unreadable or reformatted document', async ({ assert }) => {
    const document = await readFile(committed, 'utf8')

    const check = async () => {
      const failure = await run('node', ['ace', 'openapi:check'], { cwd: dir }).then(
        () => undefined,
        (error: { stdout: string; stderr: string }) => `${error.stdout}${error.stderr}`,
      )

      assert.exists(failure)

      return failure!
    }

    await rm(committed)
    assert.include(await check(), 'openapi.json does not exist: run node ace openapi:generate')

    await writeFile(committed, '{')
    assert.include(await check(), 'openapi.json is not valid JSON: run node ace openapi:generate')

    await writeFile(committed, JSON.stringify(JSON.parse(document)))
    assert.include(
      await check(),
      'openapi.json differs in its formatting only: run node ace openapi:generate',
    )
  })

  test('fails and names what differs when the document is out of date', async ({ assert }) => {
    const document: OpenApiDocument = JSON.parse(await readFile(committed, 'utf8'))
    document.info.version = '0.0.0'
    await writeFile(committed, `${JSON.stringify(document, null, 2)}\n`)

    const error = await run('node', ['ace', 'openapi:check'], { cwd: dir }).then(
      () => undefined,
      (failure: { stdout: string; stderr: string }) => failure,
    )

    assert.exists(error)
    assert.include(`${error!.stdout}${error!.stderr}`, '/info/version')
  })
})
