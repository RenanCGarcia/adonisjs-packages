import { execFile } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { promisify } from 'node:util'

import { test } from '@japa/runner'

import { agent, playgroundUrl, queue, servePlayground, type Agent } from './helpers/http.ts'

const playground = new URL('../../../playground/', import.meta.url)
const run = promisify(execFile)

type Status = 'queued' | 'in_progress' | 'closed'

type View = 'mine' | 'unassigned' | 'bot' | 'open' | 'closed'

const SEEDED_AGENTS = ['ana', 'bruno', 'carla', 'diego', 'elisa', 'felipe'].map(
  name => `${name}@inbox.test`,
)

interface Row {
  id: number
  status: Status
  lastActivityAt: string
  queue: { id: number; name: string }
  assignee: { id: number; kind: string; name: string } | null
  contact: { name: string | null; address: string }
  lastMessage: { direction: string; text: string; author: { name: string } | null } | null
}

interface List {
  status: number
  data: Row[]
  metadata: { total: number; currentPage: number; lastPage: number }
  views: Record<View, number>
  queues: Record<string, number>
}

interface Detail {
  status: number
  data: {
    ticket: Row & {
      messages: Array<{
        direction: string
        text: string
        status: string | null
        author: { name: string } | null
      }>
      events: Array<{ type: string; actor: { kind: string; name: string } }>
    }
    runs: unknown[]
  }
}

interface AgentView {
  id: number
  userId: number
  email: string
  active: boolean
  queues: Array<{ id: number; name: string }>
}

/**
 * A fresh queue the admin is a member of, with a fake channel on it, so each test reads only
 * its own tickets.
 */
async function inbox(admin: Agent) {
  const queueId = await queue(admin, admin)
  const channel = await admin.post<{ id: number }>('/inbox/channels', { queueId, name: 'Console' })

  const writeIn = (from: string, name: string, text: string) =>
    admin.post<{ receipt: string; ticketId: number }>(
      `/inbox/channels/${channel.id}/simulate-inbound`,
      { from, name, text },
    )

  const list = (query = '') => admin.get<List>(`/inbox/tickets?channelId=${channel.id}${query}`)

  return { queueId, channelId: channel.id, writeIn, list }
}

async function attendantOf(admin: Agent, userId: number) {
  const { data } = await admin.get<{ data: AgentView[] }>('/inbox/attendants')

  return data.find(view => view.userId === userId)!
}

test.group('the console API', group => {
  servePlayground(group)

  test('simulate-inbound opens a queued ticket carrying the message', async ({ assert }) => {
    const admin = await agent()
    const { writeIn } = await inbox(admin)

    const written = await writeIn('+5511900000001', 'Maria Silva', 'meu pedido atrasou')
    const detail = await admin.get<Detail>(`/inbox/tickets/${written.ticketId}`)
    const { ticket } = detail.data

    assert.equal(written.status, 202)
    assert.equal(written.receipt, 'accepted')
    assert.equal(ticket.status, 'queued')
    assert.deepEqual(
      [ticket.contact.name, ticket.contact.address],
      ['Maria Silva', '+5511900000001'],
    )
    assert.deepEqual(
      ticket.messages.map(({ direction, text }) => [direction, text]),
      [['inbound', 'meu pedido atrasou']],
    )
    assert.deepEqual(
      ticket.events.map(({ type, actor }) => [type, actor.kind]),
      [['opened', 'system']],
    )
  })

  test('the detail shows a reply with its author and delivery status', async ({ assert }) => {
    const admin = await agent()
    const { writeIn } = await inbox(admin)
    const { ticketId } = await writeIn(`+55${randomUUID()}`, 'Joana', 'oi')

    await admin.post(`/inbox/tickets/${ticketId}/messages`, { text: 'olá, Joana' })
    const { ticket } = (await admin.get<Detail>(`/inbox/tickets/${ticketId}`)).data
    const me = await attendantOf(admin, admin.userId)

    assert.equal(ticket.status, 'in_progress')
    assert.equal(ticket.assignee?.id, me.id)
    assert.deepEqual(
      ticket.messages.map(({ direction, text, status, author }) => [
        direction,
        text,
        status,
        author?.name ?? null,
      ]),
      [
        ['inbound', 'oi', null, null],
        ['outbound', 'olá, Joana', 'sent', me.email],
      ],
    )
    assert.deepEqual(
      [ticket.lastMessage?.direction, ticket.lastMessage?.text, ticket.lastMessage?.author?.name],
      ['outbound', 'olá, Joana', me.email],
    )
  })

  test('the ticket list filters by status, assignee, queue and contact', async ({ assert }) => {
    const admin = await agent()
    const { writeIn, list, queueId } = await inbox(admin)
    const me = await attendantOf(admin, admin.userId)

    const waiting = await writeIn('+5511911110001', 'Carlos Andrade', 'um')
    const held = await writeIn('+5511911110002', 'Débora Nunes', 'dois')
    const done = await writeIn('+5521922220003', 'Elias Moura', 'três')

    await admin.post(`/inbox/tickets/${held.ticketId}/assume`)
    await admin.post(`/inbox/tickets/${done.ticketId}/assume`)
    await admin.post(`/inbox/tickets/${done.ticketId}/close`, { reason: 'manual' })

    const ids = (answer: List) => answer.data.map(row => row.id).sort((a, b) => a - b)
    const all = await list()

    assert.deepEqual(ids(all), [waiting.ticketId, held.ticketId, done.ticketId])

    const activity = all.data.map(row => row.lastActivityAt)
    assert.deepEqual(activity, [...activity].sort().reverse(), 'the latest activity comes first')

    const open = await list('&status=queued,in_progress')
    assert.deepEqual(ids(open), [waiting.ticketId, held.ticketId])
    assert.deepEqual(ids(await list('&status=queued&status=in_progress')), ids(open))

    assert.deepEqual(ids(await list('&assignee=unassigned')), [waiting.ticketId])
    assert.deepEqual(ids(await list(`&assignee=${me.id}&status=in_progress`)), [held.ticketId])
    assert.deepEqual(ids(await list('&assignee=bot')), [])
    assert.deepEqual(ids(await list(`&queueId=${queueId}`)), ids(all))

    const searched = await list('&search=nUNES')
    assert.deepEqual(ids(searched), [held.ticketId])
    assert.deepEqual(ids(await list('&search=55219')), [done.ticketId])

    const first = await list('&perPage=2')
    const second = await list('&perPage=2&page=2')
    assert.deepEqual([first.data.length, second.data.length, first.metadata.total], [2, 1, 3])
  })

  test('each view lists and counts its tickets, within the channel and search', async ({
    assert,
  }) => {
    const admin = await agent()
    const colleague = await agent()
    const { writeIn, list, queueId, channelId } = await inbox(admin)
    await admin.post(`/inbox/queues/${queueId}/members`, { userId: colleague.userId })

    const waiting = await writeIn('+5511933330001', 'Fábio Reis', 'um')
    const mine = await writeIn('+5511933330002', 'Gisele Prado', 'dois')
    const theirs = await writeIn('+5511933330003', 'Heitor Lima', 'três')
    const bot = await writeIn('+5511933330004', 'Ingrid Sá', 'quatro')
    const done = await writeIn('+5511933330005', 'Jonas Ramos', 'cinco')

    await admin.post(`/inbox/tickets/${mine.ticketId}/assume`)
    await colleague.post(`/inbox/tickets/${theirs.ticketId}/assume`)
    await admin.post(`/inbox/tickets/${bot.ticketId}/assign`, { bot: 'triage' })
    await admin.post(`/inbox/tickets/${done.ticketId}/close`, { reason: 'manual' })

    const ids = async (view: View) =>
      (await list(`&view=${view}`)).data.map(row => row.id).sort((a, b) => a - b)

    const all = await list()
    const searched = await list('&view=mine&search=heitor')

    const colleagueMine = await colleague.get<List>(
      `/inbox/tickets?channelId=${channelId}&view=mine`,
    )

    assert.deepEqual(all.views, { mine: 1, unassigned: 1, bot: 1, open: 4, closed: 1 })
    assert.deepEqual(all.queues, { [queueId]: 4 })
    assert.deepEqual(await ids('mine'), [mine.ticketId])
    assert.deepEqual(await ids('unassigned'), [waiting.ticketId])
    assert.deepEqual(await ids('bot'), [bot.ticketId])
    assert.deepEqual(await ids('open'), [
      waiting.ticketId,
      mine.ticketId,
      theirs.ticketId,
      bot.ticketId,
    ])
    assert.deepEqual(await ids('closed'), [done.ticketId])
    assert.deepEqual(
      colleagueMine.data.map(row => row.id),
      [theirs.ticketId],
      "a colleague's mine view is their own",
    )
    assert.deepEqual(searched.data, [])
    assert.deepEqual(searched.views, { mine: 0, unassigned: 0, bot: 0, open: 1, closed: 0 })
    assert.deepEqual(searched.queues, { [queueId]: 1 })
  })

  test('an unknown status in the filter is a validation error', async ({ assert }) => {
    const admin = await agent()

    assert.equal((await admin.get('/inbox/tickets?status=open')).status, 422)
  })

  test('a new agent can log in and work the queues it was created in', async ({ assert }) => {
    const admin = await agent()
    const { queueId, writeIn } = await inbox(admin)
    const email = `agent-${randomUUID()}@example.com`

    const created = await admin.post<{ data: AgentView }>('/inbox/attendants', {
      fullName: 'Nova Agente',
      email,
      password: 'inbox-password',
      queueIds: [queueId],
    })

    const listed = await attendantOf(admin, created.data.userId)

    const login = await fetch(playgroundUrl('/api/v1/auth/login'), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email, password: 'inbox-password' }),
    })

    // SAFETY: the login route answers with the user's access token.
    const { data } = (await login.json()) as { data: { token: string } }
    const { ticketId } = await writeIn(`+55${randomUUID()}`, 'Cliente', 'oi')

    const assumed = await fetch(playgroundUrl(`/inbox/tickets/${ticketId}/assume`), {
      method: 'POST',
      headers: { authorization: `Bearer ${data.token}` },
    })

    const { ticket } = (await admin.get<Detail>(`/inbox/tickets/${ticketId}`)).data

    assert.equal(created.status, 201)
    assert.deepEqual(
      [listed.email, listed.active, listed.queues.map(({ id }) => id)],
      [email, true, [queueId]],
    )
    assert.equal(login.status, 200)
    assert.equal(assumed.status, 200)
    assert.deepEqual(ticket.assignee, { id: listed.id, kind: 'human', name: 'Nova Agente' })
  })

  test('queues and channels list what was created, with counts', async ({ assert }) => {
    const admin = await agent()
    const { queueId, channelId, writeIn } = await inbox(admin)

    await writeIn(`+55${randomUUID()}`, 'A', 'oi')
    const held = await writeIn(`+55${randomUUID()}`, 'B', 'oi')
    await admin.post(`/inbox/tickets/${held.ticketId}/assume`)

    const queues = await admin.get<{
      data: Array<{ id: number; members: number; queued: number; inProgress: number }>
    }>('/inbox/queues')

    const channels = await admin.get<{
      data: Array<{ id: number; name: string; defaultQueue: { id: number } }>
    }>('/inbox/channels')

    const listedQueue = queues.data.find(row => row.id === queueId)
    const listedChannel = channels.data.find(row => row.id === channelId)

    assert.deepEqual(listedQueue, { ...listedQueue!, members: 1, queued: 1, inProgress: 1 })
    assert.equal(listedChannel?.name, 'Console')
    assert.equal(listedChannel?.defaultQueue.id, queueId)
  })
})

test.group('inbox:seed', group => {
  servePlayground(group)

  test('seeds agents who can log in and tickets in every status, and a rerun changes nothing', async ({
    assert,
  }) => {
    await run('node', ['ace', 'inbox:seed'], { cwd: playground })

    const login = await fetch(playgroundUrl('/api/v1/auth/login'), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: 'ana@inbox.test', password: 'inbox-password' }),
    })

    // SAFETY: the login route answers with the user's access token.
    const { data } = (await login.json()) as { data: { token: string } }

    // SAFETY: each path read below answers with the type its caller names.
    const get = async <T>(path: string): Promise<T> =>
      (
        await fetch(playgroundUrl(path), { headers: { authorization: `Bearer ${data.token}` } })
      ).json() as Promise<T>

    const channels = await get<{ data: Array<{ id: number; name: string }> }>('/inbox/channels')
    const seeded = channels.data.filter(channel => ['WhatsApp', 'Site chat'].includes(channel.name))

    const snapshot = async () =>
      Promise.all(
        seeded.map(async channel =>
          (await get<List>(`/inbox/tickets?channelId=${channel.id}&perPage=100`)).data.map(row => [
            row.id,
            row.status,
            row.assignee?.name ?? null,
          ]),
        ),
      )

    const before = await snapshot()
    await run('node', ['ace', 'inbox:seed'], { cwd: playground })
    const after = await snapshot()

    const statuses = new Set(before.flat().map(([, status]) => status))
    const agents = await get<{ data: AgentView[] }>('/inbox/attendants')
    const seededAgents = agents.data.filter(view => SEEDED_AGENTS.includes(view.email))

    assert.equal(login.status, 200)
    assert.deepEqual(seeded.map(channel => channel.name).sort(), ['Site chat', 'WhatsApp'])
    assert.isAtLeast(before.flat().length, 20)
    assert.deepEqual(
      [...statuses].sort((a, b) => String(a).localeCompare(String(b))),
      ['closed', 'in_progress', 'queued'],
    )
    assert.isTrue(
      before.flat().some(([, , name]) => name === 'triage'),
      'a bot holds a ticket',
    )
    assert.equal(seededAgents.length, SEEDED_AGENTS.length)
    assert.isTrue(seededAgents.every(view => view.queues.length > 0))
    assert.deepEqual(after, before)
  })
})
