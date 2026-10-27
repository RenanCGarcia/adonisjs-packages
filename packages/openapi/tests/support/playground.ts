import { execFile } from 'node:child_process'
import { rmSync } from 'node:fs'
import { cp, mkdir, mkdtemp, readFile, symlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import type {
  JsonSchema,
  OpenApiDocument,
  OpenApiReference,
  OpenApiResponse,
} from '../../src/types.ts'

export const playground = new URL('../../../../playground/', import.meta.url)
export const brokenApp = new URL('../fixtures/broken_app/', import.meta.url)
export const unauthorizedApp = new URL('../fixtures/unauthorized_app/', import.meta.url)
export const inlineApp = new URL('../fixtures/inline_app/', import.meta.url)
export const componentsApp = new URL('../fixtures/components_app/', import.meta.url)
export const run = promisify(execFile)

/**
 * The response a test expects in the operation, failing on a `$ref` to `components.responses`.
 */
export function inline(response: OpenApiResponse | OpenApiReference | undefined) {
  if (!response || '$ref' in response)
    throw new Error(`expected an inline response, got ${JSON.stringify(response)}`)

  return response
}

/**
 * The response itself, or the one its `$ref` names in `components.responses`.
 */
export function resolved(
  document: OpenApiDocument,
  response: OpenApiResponse | OpenApiReference | undefined,
) {
  if (!response || !('$ref' in response)) return inline(response)

  return inline(document.components.responses?.[response.$ref.split('/').at(-1)!])
}

export const json = (response: OpenApiResponse | OpenApiReference | undefined) =>
  inline(response).content!['application/json']!.schema

export const object = (properties: Record<string, JsonSchema>): JsonSchema => ({
  type: 'object',
  properties,
  additionalProperties: false,
  required: Object.keys(properties),
})

let generated: Promise<{ document: OpenApiDocument; logs: string; raw: string }> | undefined

/**
 * Generates the document of a copy of the playground once for every spec that reads it.
 */
export function generatePlayground() {
  generated ??= (async () => {
    const { dir, output: logs } = await generateInCopy(async () => {})
    const raw = await readFile(join(dir, 'openapi.json'), 'utf8')
    const document: OpenApiDocument = JSON.parse(raw)

    return { document, logs, raw }
  })()

  return generated
}

const copies = new Set<string>()

// Specs read a copy after it is generated, so the copies go when the test process does.
process.once('exit', () => {
  for (const dir of copies) rmSync(dir, { recursive: true, force: true })
})

/**
 * A copy of the playground with `overlay` laid over it, so a test can change it and write in it
 * while the playground stays as it is.
 */
export async function copyPlayground(overlay: (dir: string) => Promise<void>) {
  const source = fileURLToPath(playground)
  const dir = await mkdtemp(join(tmpdir(), 'openapi-copy-'))

  copies.add(dir)

  await cp(source, dir, {
    recursive: true,
    filter: path =>
      !/^(node_modules|tmp|build|\.adonisjs|openapi\.json)(\/|$)/.test(relative(source, path)),
  })
  await symlink(join(source, 'node_modules'), join(dir, 'node_modules'))
  await mkdir(join(dir, 'tmp'))
  await overlay(dir)
  await run('node', ['ace', 'codegen'], { cwd: dir })

  return dir
}

/**
 * Generates the document of a copy of the playground with `overlay` laid over it. Returns the
 * copy's directory and what `openapi:generate` printed.
 */
export async function generateInCopy(overlay: (dir: string) => Promise<void>) {
  const dir = await copyPlayground(overlay)

  const result = await run('node', ['ace', 'openapi:generate'], { cwd: dir }).then(
    success => success,
    (error: { stdout: string; stderr: string }) => error,
  )

  return { dir, output: `${result.stdout}${result.stderr}` }
}
