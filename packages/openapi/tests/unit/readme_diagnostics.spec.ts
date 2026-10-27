import { readFile } from 'node:fs/promises'
import { test } from '@japa/runner'

async function codesIn(file: string, row: RegExp) {
  const text = await readFile(new URL(file, import.meta.url), 'utf8')

  return text
    .split('\n')
    .filter(line => row.test(line))
    .map(line => /OA-[A-Z]\d{3}/.exec(line)![0])
}

test.group('README diagnostics table', () => {
  test('lists every DiagnosticCode, and only those', async ({ assert }) => {
    const declared = await codesIn('../../src/types/generated.ts', /^\s+\| 'OA-/)
    const documented = await codesIn('../../README.md', /^\| `OA-/)

    assert.isAbove(declared.length, 0)
    assert.sameMembers(documented, declared)
    assert.lengthOf(new Set(documented), documented.length)
  })
})
