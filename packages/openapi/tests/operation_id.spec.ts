import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { Assert } from '@japa/assert'
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

async function documentIn(dir: string) {
  const raw = await readFile(join(dir, 'openapi.json'), 'utf8')
  const document: OpenApiDocument = JSON.parse(raw)

  return { raw, document }
}

function assertComponentsValid(
  assert: Assert,
  { raw, document }: { raw: string; document: OpenApiDocument },
) {
  for (const name of Object.keys(document.components.schemas))
    assert.match(name, /^[a-zA-Z0-9._-]+$/)

  assert.notMatch(raw, /"\$ref":"(?!#\/components\/(schemas|responses)\/)/)

  for (const [, kind, name] of raw.matchAll(/"\$ref":"#\/components\/(\w+)\/([^"]*)"/g)) {
    const names = kind === 'schemas' ? document.components.schemas : document.components.responses

    assert.property(names, name!, `#/components/${kind}/${name} resolves`)
  }
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

  test('names the shared body of an id with a space and a slash as a valid component', async ({
    assert,
  }) => {
    const { dir, output } = await generateWith('({ method, path }) => `${method} ${path}`')
    const generated = await documentIn(dir)

    assert.notInclude(output, 'OA-O001')
    assert.equal(
      generated.document.paths['/api/v1/probe/echo']!.post!.operationId,
      'post /api/v1/probe/echo',
    )
    assertComponentsValid(assert, generated)
  })

  test('numbers the shared bodies of ids that become the same name', async ({ assert }) => {
    const { dir } = await generateWith(
      "(() => { let count = 0; return () => `op${' '.repeat(++count)}` })()",
    )

    const generated = await documentIn(dir)

    const names = Object.keys(generated.document.components.schemas).filter(name =>
      name.startsWith('op.'),
    )

    assert.includeMembers(names, ['op.body', 'op.body_2'])
    assertComponentsValid(assert, generated)
  })
})
