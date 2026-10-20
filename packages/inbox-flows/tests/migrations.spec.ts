import { spawnSync } from 'node:child_process'
import { readdir } from 'node:fs/promises'

import { test } from '@japa/runner'
import { copyApp, migrateApp } from '@enzopita/adonisjs-inbox/testing'

import { fixture } from './fixture.ts'

function ace(root: URL, ...args: string[]) {
  const { status, stdout, stderr } = spawnSync('node', ['ace', ...args], {
    cwd: root,
    encoding: 'utf8',
  })

  return { exitCode: status, output: stdout + stderr }
}

const migrationsOf = async (root: URL) =>
  (await readdir(new URL('database/migrations/', root))).sort()

test.group('migrations', group => {
  // A copy's migration:fresh drops every table on a shared pg database, so the fixture's own
  // tables come back for the groups after this one.
  group.teardown(() => migrateApp(fixture))

  test('flows:migrations publishes what the app lacks, once, and --check tells', async ({
    assert,
    cleanup,
  }) => {
    const copy = await copyApp(fixture, file => !file.includes('_inbox_flows_'))
    cleanup(() => {
      ace(copy.root, 'migration:reset', '--force')

      return copy.remove()
    })

    const lacking = ace(copy.root, 'flows:migrations', '--check')
    assert.equal(lacking.exitCode, 1)
    assert.include(lacking.output, '0001_create_inbox_flows_tables')

    const publish = ace(copy.root, 'flows:migrations')
    assert.equal(publish.exitCode, 0, publish.output)
    assert.match(
      publish.output,
      /create database\/migrations\/\d+_inbox_flows_0001_create_inbox_flows_tables\.ts/,
    )
    const published = await migrationsOf(copy.root)

    const again = ace(copy.root, 'flows:migrations')
    assert.include(again.output, 'has every migration')
    assert.deepEqual(await migrationsOf(copy.root), published)
    assert.equal(ace(copy.root, 'flows:migrations', '--check').exitCode, 0)

    const migrate = ace(copy.root, 'migration:fresh', '--force')
    assert.equal(migrate.exitCode, 0, migrate.output)

    const tick = ace(copy.root, 'flows:tick')
    assert.equal(tick.exitCode, 0, tick.output)
  })

  test('the fixture has every flows migration', async ({ assert }) => {
    const check = ace(fixture, 'flows:migrations', '--check')

    assert.equal(check.exitCode, 0, check.output)
  })
})
