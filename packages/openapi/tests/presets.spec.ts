import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { test } from '@japa/runner'
import type { OpenApiDocument } from '../src/types.ts'
import { generateInCopy, generatePlayground, json, object, run } from './support/playground.ts'

async function generateWithErrors(errors: string, imports = '') {
  const { dir, output } = await generateInCopy(async copy => {
    const config = join(copy, 'config/openapi.ts')
    const source = await readFile(config, 'utf8')

    await writeFile(
      config,
      imports +
        source
          .replace(/^import \{ errors as \w+ \} from '@adonisjs\/\w+'\n/gm, '')
          .replace(/ {2}errors: \{\n.*?\n {2}\},\n/s, errors),
    )
  })

  const raw = await readFile(join(dir, 'openapi.json'), 'utf8')
  const document: OpenApiDocument = JSON.parse(raw)

  return { dir, raw, document, output }
}

test.group('openapi:generate with the presets of first-party packages', () => {
  test('documents the same responses without errors.throwers and errors.middleware', async ({
    assert,
  }) => {
    const [explicit, preset] = await Promise.all([generatePlayground(), generateWithErrors('')])

    assert.equal(preset.raw, explicit.raw)
    assert.notInclude(preset.output, 'OA-E003')
  })

  test('documents the 400 of verifyCredentials with the body E_INVALID_CREDENTIALS renders', async ({
    assert,
  }) => {
    const { document } = await generatePlayground()

    assert.deepEqual(
      json(document.paths['/api/v1/auth/login']!.post!.responses['400']),
      object({
        errors: {
          type: 'array',
          items: object({ message: { type: 'string' } }),
        },
      }),
    )
  })

  test('replaces a preset with the entry of the app under its key', async ({ assert }) => {
    const { document } = await generateWithErrors(
      '  errors: { throwers: { verifyCredentials: PlanLimitException } },\n',
      "import PlanLimitException from '#exceptions/plan_limit_exception'\n",
    )

    const responses = document.paths['/api/v1/auth/login']!.post!.responses

    assert.properties(responses, ['402'])
    assert.notProperty(responses, '400')
  })

  test('turns off a preset with false', async ({ assert }) => {
    const { document, output } = await generateWithErrors(
      "  errors: { throwers: { 'bouncer.authorize': false }, middleware: { 'limiter.define': false } },\n",
    )

    assert.deepEqual(Object.keys(document.paths['/api/v1/probe/authorized']!.get!.responses), [
      '200',
    ])
    assert.deepEqual(Object.keys(document.paths['/api/v1/probe/throttled']!.get!.responses), [
      '200',
    ])
    assert.notInclude(output, 'OA-R003 probe.throttled')
  })

  test('warns about a false key that names no preset', async ({ assert }) => {
    const { output } = await generateWithErrors(
      "  errors: { throwers: { 'bouncer.authorise': false } },\n",
    )

    assert.include(output, "errors.throwers['bouncer.authorise'] is false but names no preset")
  })

  test('replaces the preset of every throttle under limiter.define', async ({ assert }) => {
    const { document, output } = await generateWithErrors(
      "  errors: { middleware: { 'limiter.define': MaintenanceException } },\n",
      "import MaintenanceException from '#exceptions/maintenance_exception'\n",
    )

    const responses = document.paths['/api/v1/probe/throttled']!.get!.responses

    assert.properties(responses, ['503'])
    assert.notProperty(responses, '429')
    assert.notInclude(output, 'OA-E003')
  })

  test('documents one response per class of an array', async ({ assert }) => {
    const { document, output } = await generateWithErrors(
      '  errors: { throwers: { verifyCredentials: [PlanLimitException, MaintenanceException] } },\n',
      "import PlanLimitException from '#exceptions/plan_limit_exception'\nimport MaintenanceException from '#exceptions/maintenance_exception'\n",
    )

    const responses = document.paths['/api/v1/auth/login']!.post!.responses

    assert.properties(responses, ['402', '503'])
    assert.notProperty(responses, '400')
    assert.notInclude(output, 'OA-E')
  })

  test('names the item of an array whose status cannot be read', async ({ assert }) => {
    const { document, output } = await generateWithErrors(
      '  errors: { throwers: { verifyCredentials: [PlanLimitException, Error] } },\n',
      "import PlanLimitException from '#exceptions/plan_limit_exception'\n",
    )

    assert.properties(document.paths['/api/v1/auth/login']!.post!.responses, ['402'])
    assert.include(output, "errors.throwers['verifyCredentials'][1]: the status of Error")
  })

  test('reads an array that a const holds, through a const that holds it', async ({ assert }) => {
    const { document, output } = await generateWithErrors(
      "  errors: { throwers: { 'ally.user': allyFailures } },\n",
      [
        "import { errors as allyErrors } from '@adonisjs/ally'",
        'const base = [allyErrors.E_OAUTH_STATE_MISMATCH, allyErrors.E_OAUTH_MISSING_CODE]',
        'const allyFailures = (base satisfies unknown[])',
        '',
      ].join('\n'),
    )

    assert.sameMembers(Object.keys(document.paths['/oauth/github/callback']!.get!.responses), [
      '200',
      '400',
      '500',
    ])
    assert.notInclude(output, 'OA-E')
  })

  test('reads an array written with as const and keeps the playground typechecking', async ({
    assert,
  }) => {
    const { dir, document, output } = await generateWithErrors(
      "  errors: { throwers: { 'ally.user': allyFailures } },\n",
      [
        "import { errors as allyErrors } from '@adonisjs/ally'",
        'const allyFailures = [allyErrors.E_OAUTH_STATE_MISMATCH, allyErrors.E_OAUTH_MISSING_CODE] as const',
        '',
      ].join('\n'),
    )

    assert.sameMembers(Object.keys(document.paths['/oauth/github/callback']!.get!.responses), [
      '200',
      '400',
      '500',
    ])
    assert.notInclude(output, 'OA-E')

    await run('node', ['ace', 'codegen'], { cwd: dir })
    await run('node_modules/.bin/tsc', ['--noEmit'], { cwd: dir })
  })

  test('documents the classes of a spread and points OA-E001 at the right item', async ({
    assert,
  }) => {
    const { document, output } = await generateWithErrors(
      '  errors: { throwers: { verifyCredentials: [...paid, ...[...limits], Error] } },\n',
      [
        "import PlanLimitException from '#exceptions/plan_limit_exception'",
        "import MaintenanceException from '#exceptions/maintenance_exception'",
        'const paid = [PlanLimitException] as const',
        'const limits = [MaintenanceException]',
        '',
      ].join('\n'),
    )

    assert.properties(document.paths['/api/v1/auth/login']!.post!.responses, ['402', '503'])
    assert.include(output, "errors.throwers['verifyCredentials'][2]: the status of Error")
  })

  test('warns on a spread it cannot resolve instead of naming a wrong item', async ({ assert }) => {
    const { document, output } = await generateWithErrors(
      "  errors: { throwers: { 'ally.user': [allyErrors.E_OAUTH_STATE_MISMATCH, ...more(), Error] } },\n",
      [
        "import { errors as allyErrors } from '@adonisjs/ally'",
        'function more() { return [allyErrors.E_OAUTH_MISSING_CODE] }',
        '',
      ].join('\n'),
    )

    assert.property(document.paths['/oauth/github/callback']!.get!.responses, '400')
    assert.include(
      output,
      "errors.throwers['ally.user'] spreads an array the generator cannot read",
    )
    assert.include(output, "errors.throwers['ally.user'][2]: the status of Error")
    assert.notInclude(output, "errors.throwers['ally.user'][1]")
  })

  test('documents a class written between two unreadable spreads', async ({ assert }) => {
    const { document, output } = await generateWithErrors(
      "  errors: { throwers: { 'ally.user': [allyErrors.E_OAUTH_STATE_MISMATCH, ...more(), PlanLimitException, Error, ...other(), MaintenanceException] } },\n",
      [
        "import { errors as allyErrors } from '@adonisjs/ally'",
        "import PlanLimitException from '#exceptions/plan_limit_exception'",
        "import MaintenanceException from '#exceptions/maintenance_exception'",
        'function more() { return [allyErrors.E_OAUTH_MISSING_CODE] }',
        'function other() { return [allyErrors.E_OAUTH_ACCESS_DENIED] }',
        '',
      ].join('\n'),
    )

    assert.properties(document.paths['/oauth/github/callback']!.get!.responses, [
      '400',
      '402',
      '503',
    ])
    assert.include(output, "errors.throwers['ally.user'][3]: the status of Error")
  })

  test('warns on an empty array and suggests false', async ({ assert }) => {
    const { output } = await generateWithErrors("  errors: { throwers: { 'ally.user': [] } },\n")

    assert.include(output, 'OA-E003')
    assert.include(output, "errors.throwers['ally.user'] is an empty array")
    assert.include(output, 'false')
  })
})
