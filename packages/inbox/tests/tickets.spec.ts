import { execFile, spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { once } from 'node:events'
import { createServer, type AddressInfo } from 'node:net'
import { DatabaseSync } from 'node:sqlite'
import { setTimeout as sleep } from 'node:timers/promises'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'

import { test } from '@japa/runner'

const playground = new URL('../../../playground/', import.meta.url)
const run = promisify(execFile)

interface Ticket {
  id: number
  version: number
  unreadCount: number
  state:
    | { status: 'queued'; queueId: number }
    | { status: 'in_progress'; queueId: number; assignee: { kind: 'human' | 'bot'; id: number } }
    | { status: 'closed'; queueId: number; reason: string }
}

interface Answer {
  status: number
  outcome?: string
  reason?: string
  opened?: boolean
  ticket: Ticket
}

interface TicketEvent {
  type: string
  data: object
  actor_kind: string
  actor_id: number | null
  actor_source: string | null
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

/**
 * The playground's own database file, for reading the rows a request wrote and for writing rows
 * no request would.
 */
function database() {
  return new DatabaseSync(fileURLToPath(new URL('tmp/db.sqlite3', playground)), { timeout: 5000 })
}

let baseUrl: string

type Body = Record<string, string | number>

async function call<T>(token: string, method: string, path: string, body?: Body) {
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers: { 'content-type': 'application/json', 'authorization': `Bearer ${token}` },
    body: body === undefined ? undefined : JSON.stringify(body),
  })

  const text = await response.text()
  const answer: T = JSON.parse(text === '' ? '{}' : text)

  return { ...answer, status: response.status }
}

async function agent() {
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
  const post = <T = Answer>(path: string, body?: Body) => call<T>(token, 'POST', path, body)

  return {
    userId,
    post,
    del: (path: string) => call<Answer>(token, 'DELETE', path),
    assume: (ticket: Ticket) => post(`/inbox/tickets/${ticket.id}/assume`),
  }
}

type Agent = Awaited<ReturnType<typeof agent>>

async function queue(admin: Agent, ...members: Agent[]) {
  const { id } = await admin.post<{ id: number }>('/inbox/queues', {
    name: `queue-${randomUUID()}`,
  })

  for (const member of members) {
    await admin.post(`/inbox/queues/${id}/members`, { userId: member.userId })
  }

  return id
}

async function openTicket(by: Agent, queueId: number) {
  const channel = await by.post<{ id: number }>('/inbox/channels', { queueId })

  const opened = await by.post(`/inbox/channels/${channel.id}/conversations`, {
    address: `+55${randomUUID()}`,
  })

  return opened.ticket
}

function eventsOf(ticket: Ticket) {
  const db = database()

  try {
    return db
      .prepare(
        'SELECT type, data, actor_kind, actor_id, actor_source FROM inbox_ticket_events WHERE ticket_id = ? ORDER BY id',
      )
      .all(ticket.id)
      .map((row): TicketEvent => ({
        type: String(row.type),
        data: JSON.parse(String(row.data)),
        actor_kind: String(row.actor_kind),
        // SAFETY: actor_id is an integer column, read back as a number or null.
        actor_id: row.actor_id as number | null,
        // SAFETY: actor_source is a text column, read back as a string or null.
        actor_source: row.actor_source as string | null,
      }))
  } finally {
    db.close()
  }
}

function rowOf(ticket: Ticket) {
  const db = database()

  try {
    return db.prepare('SELECT * FROM inbox_tickets WHERE id = ?').get(ticket.id)
  } finally {
    db.close()
  }
}

test.group('tickets over HTTP', group => {
  group.setup(async () => {
    await run('node', ['ace', 'migration:run', '--force', '--no-schema-generate'], {
      cwd: playground,
    })
    const server = await startPlayground()
    baseUrl = server.baseUrl

    return server.stop
  })

  test('assume, transfer, return and close each land as ticket events', async ({ assert }) => {
    const ana = await agent()
    const bea = await agent()
    const support = await queue(ana, ana)
    const billing = await queue(ana, bea)
    const ticket = await openTicket(ana, support)

    const assumed = await ana.assume(ticket)
    const anaId = assumed.ticket.state.status === 'in_progress' && assumed.ticket.state.assignee.id

    const transferred = await ana.post(`/inbox/tickets/${ticket.id}/transfer`, {
      queueId: billing,
      userId: bea.userId,
    })

    const beaId =
      transferred.ticket.state.status === 'in_progress' && transferred.ticket.state.assignee.id

    const returned = await bea.post(`/inbox/tickets/${ticket.id}/return`)
    const closed = await bea.post(`/inbox/tickets/${ticket.id}/close`, { reason: 'manual' })

    assert.deepEqual(
      [assumed, transferred, returned, closed].map(answer => [answer.status, answer.outcome]),
      [
        [200, 'changed'],
        [200, 'changed'],
        [200, 'changed'],
        [200, 'changed'],
      ],
    )
    assert.deepEqual(closed.ticket.state, {
      status: 'closed',
      queueId: billing,
      assignee: null,
      reason: 'manual',
    })
    assert.deepEqual(eventsOf(ticket), [
      {
        type: 'opened',
        data: { fact: 'opened', queueId: support, origin: 'outbound' },
        actor_kind: 'human',
        actor_id: anaId,
        actor_source: null,
      },
      {
        type: 'assignment_changed',
        data: {
          fact: 'assignment_changed',
          from: null,
          to: { kind: 'human', id: anaId },
          via: 'assume',
        },
        actor_kind: 'human',
        actor_id: anaId,
        actor_source: null,
      },
      {
        type: 'queue_changed',
        data: { fact: 'queue_changed', from: support, to: billing },
        actor_kind: 'human',
        actor_id: anaId,
        actor_source: null,
      },
      {
        type: 'assignment_changed',
        data: {
          fact: 'assignment_changed',
          from: { kind: 'human', id: anaId },
          to: { kind: 'human', id: beaId },
          via: 'transfer',
        },
        actor_kind: 'human',
        actor_id: anaId,
        actor_source: null,
      },
      {
        type: 'assignment_changed',
        data: {
          fact: 'assignment_changed',
          from: { kind: 'human', id: beaId },
          to: null,
          via: 'return',
        },
        actor_kind: 'human',
        actor_id: beaId,
        actor_source: null,
      },
      {
        type: 'closed',
        data: { fact: 'closed', reason: 'manual' },
        actor_kind: 'human',
        actor_id: beaId,
        actor_source: null,
      },
    ])
  })

  test('a repeated gesture is unchanged and records nothing', async ({ assert }) => {
    const ana = await agent()
    const ticket = await openTicket(ana, await queue(ana, ana))

    await ana.assume(ticket)
    const again = await ana.assume(ticket)

    assert.equal(again.outcome, 'unchanged')
    assert.lengthOf(eventsOf(ticket), 2)
  })

  test('a human takes a ticket back from the triage bot', async ({ assert }) => {
    const ana = await agent()
    const ticket = await openTicket(ana, await queue(ana, ana))

    const toBot = await ana.post(`/inbox/tickets/${ticket.id}/assign`, { bot: 'triage' })
    const takenBack = await ana.assume(ticket)

    assert.equal(
      toBot.ticket.state.status === 'in_progress' && toBot.ticket.state.assignee.kind,
      'bot',
    )
    assert.equal(
      takenBack.ticket.state.status === 'in_progress' && takenBack.ticket.state.assignee.kind,
      'human',
    )
  })

  test('agents assuming at once leave exactly one holder', async ({ assert }) => {
    const agents = await Promise.all([agent(), agent(), agent(), agent(), agent()])
    const support = await queue(agents[0]!, ...agents)

    const tickets = [
      await openTicket(agents[0]!, support),
      await openTicket(agents[0]!, support),
      await openTicket(agents[0]!, support),
    ]

    for (const ticket of tickets) {
      // Open one keep-alive socket per racer first, so the assumes reach the server together.
      await Promise.all(agents.map(() => fetch(baseUrl).then(response => response.text())))

      const answers = await Promise.all(agents.map(racer => racer.assume(ticket)))
      const [winner, ...others] = answers.filter(answer => answer.status === 200)

      const holder =
        winner?.ticket.state.status === 'in_progress' && winner.ticket.state.assignee.id

      assert.lengthOf(others, 0)
      assert.equal(rowOf(ticket)?.assignee_id, holder)
      assert.sameMembers(
        answers.filter(answer => answer.status !== 200).map(answer => answer.reason),
        Array.from({ length: agents.length - 1 }, () => 'held_by_other'),
      )
      assert.lengthOf(
        eventsOf(ticket).filter(event => event.type === 'assignment_changed'),
        1,
      )
    }
  })

  test('authorize vetoes closing a ticket a colleague holds', async ({ assert }) => {
    const ana = await agent()
    const bea = await agent()
    const ticket = await openTicket(ana, await queue(ana, ana, bea))

    await ana.assume(ticket)
    const vetoed = await bea.post(`/inbox/tickets/${ticket.id}/close`, { reason: 'manual' })
    const ownClose = await ana.post(`/inbox/tickets/${ticket.id}/close`, { reason: 'manual' })

    assert.deepEqual([vetoed.status, vetoed.reason], [409, 'forbidden'])
    assert.equal(ownClose.outcome, 'changed')
  })

  test('only the holder clears the unread count', async ({ assert }) => {
    const ana = await agent()
    const bea = await agent()
    const ticket = await openTicket(ana, await queue(ana, ana, bea))

    await ana.assume(ticket)
    const db = database()

    db.prepare('UPDATE inbox_tickets SET unread_count = 3 WHERE id = ?').run(ticket.id)
    db.close()

    await bea.post(`/inbox/tickets/${ticket.id}/read`)
    const afterColleague = rowOf(ticket)?.unread_count

    await ana.post(`/inbox/tickets/${ticket.id}/read`)

    assert.equal(afterColleague, 3)
    assert.equal(rowOf(ticket)?.unread_count, 0)
  })

  test('deactivating an attendant returns its tickets to the queue', async ({ assert }) => {
    const admin = await agent()
    const ana = await agent()
    const support = await queue(admin, ana)
    const tickets = [await openTicket(admin, support), await openTicket(admin, support)]

    for (const ticket of tickets) await ana.assume(ticket)

    const deactivated = await admin.post(`/inbox/attendants/${ana.userId}/deactivate`)

    assert.equal(deactivated.status, 204)

    for (const ticket of tickets) {
      assert.equal(rowOf(ticket)?.status, 'queued')
      assert.deepInclude(eventsOf(ticket).at(-1), {
        type: 'assignment_changed',
        actor_kind: 'system',
        actor_source: 'attendant_deactivated',
      })
      assert.equal((await ana.assume(ticket)).reason, 'attendant_inactive')
    }
  })

  test('removing a member returns its tickets in that queue only', async ({ assert }) => {
    const admin = await agent()
    const carl = await agent()
    const support = await queue(admin, carl)
    const billing = await queue(admin, carl)
    const inSupport = await openTicket(admin, support)
    const inBilling = await openTicket(admin, billing)

    await carl.assume(inSupport)
    await carl.assume(inBilling)

    const removed = await admin.del(`/inbox/queues/${support}/members/${carl.userId}`)

    assert.equal(removed.status, 204)
    assert.equal(rowOf(inSupport)?.status, 'queued')
    assert.equal(rowOf(inBilling)?.status, 'in_progress')
    assert.equal((await carl.assume(inSupport)).reason, 'not_member')
  })

  test('a conversation has one open ticket, and closing it frees the slot', async ({ assert }) => {
    const ana = await agent()
    const ticket = await openTicket(ana, await queue(ana, ana))
    const conversationId = Number(rowOf(ticket)?.conversation_id)

    const reopened = await ana.post(`/inbox/conversations/${conversationId}/tickets`)

    const db = database()
    const now = '2026-01-05 10:00:00'

    const secondOpen = () =>
      db
        .prepare(
          `INSERT INTO inbox_tickets (conversation_id, open_conversation_id, queue_id, status, version, bot_state, unread_count, opened_at, last_activity_at, created_at)
           VALUES (?, ?, ?, 'queued', 0, '{}', 0, ?, ?, ?)`,
        )
        .run(conversationId, conversationId, ticket.state.queueId, now, now, now)

    assert.throws(secondOpen, /UNIQUE constraint failed: inbox_tickets.open_conversation_id/)
    db.close()

    await ana.post(`/inbox/tickets/${ticket.id}/close`, { reason: 'manual' })
    const afterClose = await ana.post(`/inbox/conversations/${conversationId}/tickets`)

    assert.deepEqual([reopened.opened, reopened.ticket.id], [false, ticket.id])
    assert.equal(afterClose.opened, true)
    assert.notEqual(afterClose.ticket.id, ticket.id)
  })

  test('the database refuses a ticket or attendant row the domain forbids', async ({ assert }) => {
    const ana = await agent()
    const ticket = await openTicket(ana, await queue(ana, ana))
    const db = database()

    try {
      assert.throws(
        () =>
          db.prepare("UPDATE inbox_tickets SET status = 'in_progress' WHERE id = ?").run(ticket.id),
        /CHECK constraint failed: inbox_tickets_assignee/,
      )
      assert.throws(
        () => db.prepare("UPDATE inbox_tickets SET status = 'closed' WHERE id = ?").run(ticket.id),
        /CHECK constraint failed: inbox_tickets_open/,
      )
      assert.throws(
        () =>
          db
            .prepare(
              "INSERT INTO inbox_attendants (kind, user_id, bot_key, created_at) VALUES ('human', ?, 'triage-twin', '2026-01-05 10:00:00')",
            )
            .run(ana.userId + 1_000_000),
        /CHECK constraint failed: inbox_attendants_identity/,
      )
    } finally {
      db.close()
    }

    assert.equal(rowOf(ticket)?.status, 'queued')
  })
})
