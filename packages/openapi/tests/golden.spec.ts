import { readFile, writeFile } from 'node:fs/promises'
import { test } from '@japa/runner'
import { generatePlayground } from './support/playground.ts'

const golden = new URL('fixtures/playground.openapi.json', import.meta.url)

test.group('openapi:generate on the playground app: the golden document', group => {
  let generated: string

  group.setup(async () => {
    ;({ raw: generated } = await generatePlayground())
  })

  test('matches the committed playground document byte for byte', async ({ assert }) => {
    if (process.env.UPDATE_GOLDEN) await writeFile(golden, generated)

    const committed = await readFile(golden, 'utf8')

    const message =
      'The playground document differs from tests/fixtures/playground.openapi.json. If the change is intended, run `UPDATE_GOLDEN=1 pnpm test` in packages/openapi and explain the diff in the PR.'

    assert.deepEqual(JSON.parse(generated), JSON.parse(committed), message)
    assert.isTrue(generated === committed, message)
  })
})
