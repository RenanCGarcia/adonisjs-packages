import { execFile, spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { once } from 'node:events'
import { createServer, type AddressInfo } from 'node:net'
import { setTimeout as sleep } from 'node:timers/promises'
import { promisify } from 'node:util'

import type { Database } from '@adonisjs/lucid/database'
import type { Group } from '@japa/runner/core'

import { playgroundDatabase } from './app.ts'

const playground = new URL('../../../../playground/', import.meta.url)
const run = promisify(execFile)

export interface Ticket {
  id: number
  version: number
  unreadCount: number
  state:
    | { status: 'queued'; queueId: number }
    | { status: 'in_progress'; queueId: number; assignee: { kind: 'human' | 'bot'; id: number } }
    | { status: 'closed'; queueId: number; reason: string }
}

export interface Answer {
  status: number
  outcome?: string
  reason?: string
  opened?: boolean
  ticket: Ticket
}

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
async function startPlayground() {
  const port = await freePort()

  const child = spawn(process.execPath, ['--import=@poppinss/ts-exec', 'bin/server.ts'], {
    cwd: playground,
    env: { ...process.env, NODE_ENV: 'development', PORT: String(port), HOST: '127.0.0.1' },
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

let baseUrl: string
let db: Database

/**
 * The playground's database, for reading the rows a request wrote and for writing rows no
 * request would.
 */
export function database() {
  return db
}

export function playgroundUrl(path = '') {
  return `${baseUrl}${path}`
}

type Body = Record<string, string | number | number[]>

async function call<T>(
  token: string,
  method: string,
  path: string,
  body?: Body,
  headers: Record<string, string> = {},
) {
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers: { 'content-type': 'application/json', 'authorization': `Bearer ${token}`, ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  })

  const text = await response.text()
  const answer: T = JSON.parse(text === '' ? '{}' : text)

  return { ...answer, status: response.status }
}

export async function agent() {
  const email = `inbox-${randomUUID()}@example.com`
  const password = 'inbox-password'

  const response = await fetch(`${baseUrl}/api/v1/auth/signup`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ fullName: null, email, password, passwordConfirmation: password }),
  })

  if (response.status !== 201) throw new Error(`signup answered ${response.status}`)

  // SAFETY: the signup route answers with the new user and its access token.
  const { data } = (await response.json()) as { data: { token: string; user: { id: number } } }
  const { token } = data
  const userId = data.user.id

  const post = <T = Answer>(path: string, body?: Body, headers?: Record<string, string>) =>
    call<T>(token, 'POST', path, body, headers)

  return {
    userId,
    post,
    get: <T>(path: string) => call<T>(token, 'GET', path),
    del: (path: string) => call<Answer>(token, 'DELETE', path),
    assume: (ticket: Ticket) => post(`/inbox/tickets/${ticket.id}/assume`),
  }
}

export type Agent = Awaited<ReturnType<typeof agent>>

export async function queue(admin: Agent, ...members: Agent[]) {
  const { id } = await admin.post<{ id: number }>('/inbox/queues', {
    name: `queue-${randomUUID()}`,
  })

  for (const member of members) {
    await admin.post(`/inbox/queues/${id}/members`, { userId: member.userId })
  }

  return id
}

/**
 * Runs the playground's migrations and serves it for the group, in its own process.
 */
export function servePlayground(group: Group) {
  group.setup(async () => {
    await run('node', ['ace', 'migration:run', '--force', '--no-schema-generate'], {
      cwd: playground,
    })
    const local = await playgroundDatabase()
    const server = await startPlayground()
    baseUrl = server.baseUrl
    db = local.db

    return async () => {
      server.stop()
      await local.close()
    }
  })
}

export async function openTicket(by: Agent, queueId: number) {
  const channel = await by.post<{ id: number }>('/inbox/channels', { queueId })

  const opened = await by.post(`/inbox/channels/${channel.id}/conversations`, {
    address: `+55${randomUUID()}`,
  })

  return opened.ticket
}
