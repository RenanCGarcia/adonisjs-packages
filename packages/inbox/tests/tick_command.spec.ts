import { execFile } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { promisify } from 'node:util'

import { test } from '@japa/runner'
import { DateTime } from 'luxon'

import { migratePlayground } from './helpers/app.ts'
import { database } from './helpers/http.ts'

const playground = new URL('../../../playground/', import.meta.url)
const run = promisify(execFile)

const sqlTime = (time: DateTime) => time.toFormat('yyyy-MM-dd HH:mm:ss')

/**
 * An open ticket on its own queue, channel and contact, whose last activity was `idle` ago.
 */
function ticketIdleFor(idle: { days: number }) {
  const db = database()
  const now = sqlTime(DateTime.now())

  try {
    const insert = (sql: string, ...params: Array<string | number>) =>
      Number(db.prepare(sql).run(...params).lastInsertRowid)

    const queueId = insert(
      'INSERT INTO inbox_queues (name, created_at) VALUES (?, ?)',
      'support',
      now,
    )

    const channelId = insert(
      `INSERT INTO inbox_channels (provider, name, default_queue_id, webhook_token, credentials, created_at)
       VALUES ('fake', 'test', ?, ?, '{}', ?)`,
      queueId,
      randomUUID(),
      now,
    )

    const contactId = insert(
      'INSERT INTO inbox_contacts (channel_id, address, created_at) VALUES (?, ?, ?)',
      channelId,
      randomUUID(),
      now,
    )

    const conversationId = insert(
      'INSERT INTO inbox_conversations (channel_id, contact_id, created_at) VALUES (?, ?, ?)',
      channelId,
      contactId,
      now,
    )

    return insert(
      `INSERT INTO inbox_tickets (conversation_id, open_conversation_id, queue_id, status, version,
         bot_state, unread_count, opened_at, last_activity_at, created_at)
       VALUES (?, ?, ?, 'queued', 0, '{}', 0, ?, ?, ?)`,
      conversationId,
      conversationId,
      queueId,
      now,
      sqlTime(DateTime.now().minus(idle)),
      now,
    )
  } finally {
    db.close()
  }
}

function ticketRow(id: number) {
  const db = database()

  try {
    return db
      .prepare('SELECT status, close_reason, version FROM inbox_tickets WHERE id = ?')
      .get(id)
  } finally {
    db.close()
  }
}

test.group('inbox:tick', group => {
  group.setup(() => migratePlayground())

  test('closes the tickets the playground config finds inactive, once', async ({ assert }) => {
    const stale = ticketIdleFor({ days: 3 })
    const fresh = ticketIdleFor({ days: 0 })

    const first = await run('node', ['ace', 'inbox:tick'], { cwd: playground })
    const second = await run('node', ['ace', 'inbox:tick'], { cwd: playground })

    assert.deepInclude(ticketRow(stale), {
      status: 'closed',
      close_reason: 'inactivity',
      version: 1,
    })
    assert.deepInclude(ticketRow(fresh), { status: 'queued', version: 0 })
    assert.match(first.stdout, /close_inactive: changed [1-9]\d* of/)
    assert.include(second.stdout, 'close_inactive: changed 0 of 0 candidate tickets')
  })
})
