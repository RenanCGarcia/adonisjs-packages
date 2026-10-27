import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { test } from '@japa/runner'
import type { OpenApiDocument } from '../src/types.ts'
import { generateInCopy } from './support/playground.ts'

function generateWith(source: string) {
  return generateInCopy(async copy => {
    const config = join(copy, 'config/openapi.ts')
    const original = await readFile(config, 'utf8')

    await writeFile(
      config,
      original.replace('defineConfig({', `defineConfig({\n  operationId: ${source},`),
    )
  })
}

test.group('openapi:generate: a custom operationId', () => {
  test('names each method of each path with the function', async ({ assert }) => {
    const { dir, output } = await generateWith(
      '({ name, method, path }) => `${method}.${path}.${name}`',
    )

    const document: OpenApiDocument = JSON.parse(await readFile(join(dir, 'openapi.json'), 'utf8'))
    const echo = document.paths['/api/v1/probe/echo']!

    assert.notInclude(output, 'OA-O001')
    assert.equal(echo.get!.operationId, 'get./api/v1/probe/echo.probe.probe.echo')
    assert.equal(echo.post!.operationId, 'post./api/v1/probe/echo.probe.probe.echo')
    assert.equal(
      document.paths['/api/v1/probe/items']!.get!.operationId,
      'get./api/v1/probe/items.probe.probe.item',
    )
    assert.equal(
      document.paths['/api/v1/probe/items/{id}']!.get!.operationId,
      'get./api/v1/probe/items/{id}.probe.probe.item',
    )
  })

  test('fails on an id two operations share and writes no document', async ({ assert }) => {
    const { dir, output } = await generateWith('({ method }) => method')

    assert.match(output, /OA-O001 \S+: the operationId get is already the one of GET \/api\/v1\//)
    assert.include(output, 'The errors above block the document')
    await assert.rejects(() => readFile(join(dir, 'openapi.json')))
  })

  test('fails on an empty id', async ({ assert }) => {
    const { output } = await generateWith("() => ''")

    assert.include(output, 'operationId() must return a non-empty string')
  })
})
