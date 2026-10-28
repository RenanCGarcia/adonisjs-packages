import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from '@japa/runner'
import { readBodyParser } from '../../src/program/body_parser.ts'

async function configFile(source: string) {
  const file = join(await mkdtemp(join(tmpdir(), 'bodyparser-')), 'bodyparser.ts')
  await writeFile(file, source)

  return file
}

test.group('readBodyParser', () => {
  test('reads the methods and the parser types written as literals', async ({ assert }) => {
    const parser = readBodyParser(
      await configFile(`
        import { defineConfig } from '@adonisjs/core/bodyparser'

        export default defineConfig({
          allowedMethods: ['POST'],
          json: { types: ['application/json'] },
          form: { types: [] },
          multipart: { autoProcess: true },
        })
      `),
    )

    assert.deepEqual([...parser.methods], ['POST'])
    assert.deepEqual(parser.mediaTypes('/'), ['application/json', 'multipart/form-data'])
  })

  test('picks the standard type of each parser, or its first configured type', async ({
    assert,
  }) => {
    const parser = readBodyParser(
      await configFile(`
        export default defineConfig({
          json: { types: ['application/vnd.api+json', 'application/csp-report'] },
          form: { types: ['text/x', 'application/x-www-form-urlencoded'] },
          multipart: { types: [] },
        })
      `),
    )

    assert.deepEqual(parser.mediaTypes('/'), [
      'application/vnd.api+json',
      'application/x-www-form-urlencoded',
    ])
    assert.equal(parser.fileMediaType, 'multipart/form-data')
  })

  test('lists application/json when no parser accepts a type', async ({ assert }) => {
    const parser = readBodyParser(
      await configFile(`
        export default defineConfig({
          json: { types: [] },
          form: { types: [] },
          multipart: { types: [] },
        })
      `),
    )

    assert.deepEqual(parser.mediaTypes('/'), ['application/json'])
  })

  test('keeps the default of a setting that is not a literal array of strings', async ({
    assert,
  }) => {
    const parser = readBodyParser(
      await configFile(`
        const types = ['application/json']

        export default defineConfig({ json: { types }, form: { types: [...types, 'text/x'] } })
      `),
    )

    assert.deepEqual(parser.mediaTypes('/'), [
      'application/json',
      'application/x-www-form-urlencoded',
      'multipart/form-data',
    ])
  })

  test('leaves out multipart on the routes the bodyparser does not process it for', async ({
    assert,
  }) => {
    const off = readBodyParser(
      await configFile(`export default defineConfig({ multipart: { autoProcess: false } })`),
    )

    const scoped = readBodyParser(
      await configFile(`
        export default defineConfig({
          multipart: { autoProcess: ['/uploads', '/files/:id'], processManually: ['/files/:id'] },
        })
      `),
    )

    assert.deepEqual(off.mediaTypes('/uploads'), [
      'application/json',
      'application/x-www-form-urlencoded',
    ])
    assert.include(scoped.mediaTypes('/uploads'), 'multipart/form-data')
    assert.notInclude(scoped.mediaTypes('/files/:id'), 'multipart/form-data')
    assert.notInclude(scoped.mediaTypes('/users'), 'multipart/form-data')
  })

  test('falls back to the bodyparser defaults without a config file', ({ assert }) => {
    const parser = readBodyParser(join(tmpdir(), 'missing', 'bodyparser.ts'))

    assert.deepEqual([...parser.methods], ['POST', 'PUT', 'PATCH', 'DELETE'])
    assert.equal(parser.fileMediaType, 'multipart/form-data')
  })
})
