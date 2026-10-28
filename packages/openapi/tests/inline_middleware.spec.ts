import { cp, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { test } from '@japa/runner'
import type { OpenApiDocument } from '../src/types.ts'
import { generateInCopy, inlineApp, json, object, run } from './support/playground.ts'

test.group('openapi:generate on functions passed to .use()', group => {
  let dir: string
  let output: string
  let document: OpenApiDocument
  let routes: string[]

  group.setup(async () => {
    ;({ dir, output } = await generateInCopy(copy =>
      cp(fileURLToPath(inlineApp), copy, { recursive: true }),
    ))
    document = JSON.parse(await readFile(join(dir, 'openapi.json'), 'utf8'))
    routes = (await readFile(join(dir, 'start/routes.ts'), 'utf8')).split('\n')
  })

  const responses = (path: string) => document.paths[`/inline/${path}`]!.get!.responses

  const lineOf = (statement: string) => routes.findIndex(line => line.includes(statement)) + 1

  test('tells apart closures that differ by an operator only', async ({ assert }) => {
    for (const [route, statement] of [
      ['inline.above', "request.input('n') > 0"],
      ['inline.below', "request.input('n') < 0"],
    ] as const) {
      const { stdout } = await run('node', ['ace', 'openapi:generate', `--explain=${route}`], {
        cwd: dir,
      })

      assert.include(stdout, `the middleware closure (start/routes.ts:${lineOf(statement)})`)
    }
  })

  test('tells apart closures that differ by a keyword only', ({ assert }) => {
    assert.deepEqual(
      json(responses('allowed')['403']),
      object({ allowed: { type: 'boolean', const: true } }),
    )
    assert.deepEqual(
      json(responses('denied')['403']),
      object({ allowed: { type: 'boolean', const: false } }),
    )
  })

  test('documents no response of a function several functions of the app match', ({ assert }) => {
    for (const route of ['taken', 'unverified']) {
      assert.include(
        output,
        `OA-R004 inline.${route}: the middleware reject passed to .use() has the same source as several functions of the app (app/middleware/rejections/taken.ts:5, app/middleware/rejections/unverified.ts:5), its responses are not documented`,
      )
      assert.deepEqual(Object.keys(responses(route)), ['200'])
    }
  })

  test('documents the responses of a method passed to .use()', ({ assert }) => {
    assert.deepEqual(
      json(responses('method')['402']),
      object({ code: { type: 'string', const: 'E_UNPAID' } }),
    )
    assert.notInclude(output, 'OA-R003 inline.method')
  })

  test('documents the responses of a bound function passed to .use()', ({ assert }) => {
    assert.deepEqual(
      json(responses('bound')['429']),
      object({ code: { type: 'string', const: 'E_QUOTA' } }),
    )
    assert.notInclude(output, 'OA-R003 inline.bound')
  })

  test('documents the 429 of a throttle by the package that created it', ({ assert }) => {
    assert.deepEqual(Object.keys(responses('packaged')), ['200', '429'])
    assert.notInclude(output, 'OA-R003 inline.packaged')
  })
})

test('reports a function several functions of the app match although errors.middleware names it', async ({
  assert,
}) => {
  const { output } = await generateInCopy(async copy => {
    await cp(fileURLToPath(inlineApp), copy, { recursive: true })
    const config = join(copy, 'config/openapi.ts')
    await writeFile(
      config,
      (await readFile(config, 'utf8')).replace(
        'globalThrottle: limiterErrors.E_TOO_MANY_REQUESTS,',
        'globalThrottle: limiterErrors.E_TOO_MANY_REQUESTS,\n      reject: limiterErrors.E_TOO_MANY_REQUESTS,',
      ),
    )
  })

  assert.include(output, 'OA-R004 inline.taken: the middleware reject passed to .use()')
})
