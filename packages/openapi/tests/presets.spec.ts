import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { test } from '@japa/runner'
import type { OpenApiDocument } from '../src/types.ts'
import { generateInCopy, generatePlayground, json, object } from './support/playground.ts'

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

  return { raw, document, output }
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
      object({ errors: { type: 'array', items: object({ message: { type: 'string' } }) } }),
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
})
