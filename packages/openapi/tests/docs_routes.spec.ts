import { execFile, spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { readFile, writeFile } from 'node:fs/promises'
import { once } from 'node:events'
import { join } from 'node:path'
import { createServer, type AddressInfo } from 'node:net'
import { setTimeout as sleep } from 'node:timers/promises'
import { promisify } from 'node:util'
import { test } from '@japa/runner'
import type { OpenApiDocument } from '../src/types.ts'
import { copyPlayground } from './support/playground.ts'

const playground = new URL('../../../playground/', import.meta.url)
const run = promisify(execFile)

async function freePort() {
  const server = createServer().listen(0, '127.0.0.1')

  await once(server, 'listening')

  // SAFETY: a server listening on a TCP port has an AddressInfo address.
  const { port } = server.address() as AddressInfo

  server.close()

  return port
}

/**
 * Boots `bin/server.ts` the way `node ace serve` does, without the file watcher.
 */
async function startPlayground(
  nodeEnv: 'development' | 'production',
  cwd: URL | string = playground,
) {
  const port = await freePort()

  const child = spawn(process.execPath, ['--import=@poppinss/ts-exec', 'bin/server.ts'], {
    cwd,
    env: { ...process.env, NODE_ENV: nodeEnv, PORT: String(port), HOST: '127.0.0.1' },
    stdio: 'ignore',
  })

  const baseUrl = `http://127.0.0.1:${port}`

  for (let attempt = 0; attempt < 120; attempt++) {
    if (child.exitCode !== null) throw new Error(`the playground exited with ${child.exitCode}`)

    const ready = await fetch(baseUrl).then(
      response => response.ok,
      () => false,
    )

    if (ready) return { baseUrl, stop: () => void child.kill() }

    await sleep(250)
  }

  child.kill()
  throw new Error('the playground did not start in 30s')
}

async function signUp(baseUrl: string) {
  const email = `docs-${randomUUID()}@example.com`
  const password = 'docs-password'

  const response = await fetch(`${baseUrl}/api/v1/auth/signup`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ fullName: null, email, password, passwordConfirmation: password }),
  })

  if (response.status !== 201) throw new Error(`signup answered ${response.status}`)

  return `Basic ${Buffer.from(`${email}:${password}`).toString('base64')}`
}

test.group('docs page behind basic auth, generated live in development', group => {
  let baseUrl: string
  let authorization: string

  group.setup(async () => {
    await run('node', ['ace', 'migration:run', '--force', '--no-schema-generate'], {
      cwd: playground,
    })
    const server = await startPlayground('development')
    baseUrl = server.baseUrl
    authorization = await signUp(baseUrl)

    return server.stop
  })

  test('asks the browser for credentials', async ({ assert }) => {
    const response = await fetch(`${baseUrl}/docs`)

    assert.equal(response.status, 401)
    assert.match(response.headers.get('www-authenticate') ?? '', /^Basic /)
  })

  test('renders the Scalar page pointing at the document next to it', async ({ assert }) => {
    const response = await fetch(`${baseUrl}/docs`, { headers: { authorization } })
    const html = await response.text()

    assert.equal(response.status, 200)
    assert.equal(response.headers.get('content-type'), 'text/html; charset=utf-8')
    assert.include(
      html,
      '<script src="https://cdn.jsdelivr.net/npm/@scalar/api-reference@1/dist/browser/standalone.js"></script>',
    )
    assert.include(html, `Scalar.createApiReference('#app', {"url":"docs/openapi.json"})`)
  })

  test('serves the document of the running app without its own routes', async ({ assert }) => {
    const response = await fetch(`${baseUrl}/docs/openapi.json`, { headers: { authorization } })
    const document: OpenApiDocument = JSON.parse(await response.text())

    assert.equal(response.status, 200)
    assert.include(response.headers.get('content-type') ?? '', 'application/json')
    assert.property(document.paths, '/api/v1/users/{id}')
    assert.notProperty(document.paths, '/docs')
    assert.notProperty(document.paths, '/docs/openapi.json')
  })
})

test.group('docs page in production', group => {
  let baseUrl: string
  let authorization: string
  let written: OpenApiDocument

  group.setup(async () => {
    const dir = await copyPlayground(async () => {})
    const file = join(dir, 'openapi.json')

    await run('node', ['ace', 'migration:run', '--force', '--no-schema-generate'], { cwd: dir })
    await run('node', ['ace', 'openapi:generate'], { cwd: dir })

    // A version no live generation produces, so the response proves it came from the file.
    written = {
      ...JSON.parse(await readFile(file, 'utf8')),
      info: { title: 'API', version: randomUUID() },
    }
    await writeFile(file, JSON.stringify(written))

    const server = await startPlayground('production', dir)
    baseUrl = server.baseUrl
    authorization = await signUp(baseUrl)

    return () => server.stop()
  })

  test('serves the file openapi:generate wrote', async ({ assert }) => {
    const response = await fetch(`${baseUrl}/docs/openapi.json`, { headers: { authorization } })

    assert.equal(response.status, 200)
    assert.deepEqual(await response.json(), written)
  })
})
