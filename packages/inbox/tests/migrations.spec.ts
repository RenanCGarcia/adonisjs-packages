import { execFile, spawnSync } from 'node:child_process'
import { copyFile, mkdir, readdir, readFile, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'

import { IgnitorFactory } from '@adonisjs/core/factories'
import { compose } from '@adonisjs/core/helpers'
import { BaseModel, column } from '@adonisjs/lucid/orm'
import { test } from '@japa/runner'

import { defineConfig } from '../src/define_config.ts'
import { InboxError } from '../src/errors.ts'
import { defineMigrations, publishMigrations, type MigrationManifest } from '../src/migrations.ts'
import { withInboxTicket } from '../src/mixins/ticket.ts'
import { MODEL_ROLES, type ModelRole } from '../src/models.ts'
import { INBOX_MIGRATIONS } from '../src/schema.ts'
import { copyApp, migrateApp } from '../src/testing/app.ts'
import { stubsRoot } from '../stubs/main.ts'
import { boot, playgroundModels } from './helpers/app.ts'

const playground = new URL('../../../playground/', import.meta.url)
const run = promisify(execFile)

const withoutInbox = (file: string) => !file.includes('_inbox_')

function ace(root: URL, ...args: string[]) {
  const { status, stdout, stderr } = spawnSync('node', ['ace', ...args], {
    cwd: root,
    encoding: 'utf8',
  })

  return { exitCode: status, output: stdout + stderr }
}

async function appAt(root: URL) {
  const app = new IgnitorFactory()
    .withCoreConfig()
    .create(root, { importer: filePath => import(filePath) })
    .createApp('console')

  await app.init()

  return app
}

/**
 * The inbox's manifest plus a `0002` adding `inbox_tickets.priority`, its stubs in the app.
 */
async function manifestWithPriority(root: URL) {
  const stubs = new URL('fixture_stubs/migrations/', root)

  await mkdir(stubs, { recursive: true })
  await copyFile(
    `${stubsRoot}/migrations/0001_create_inbox_tables.stub`,
    new URL('0001_create_inbox_tables.stub', stubs),
  )
  await copyFile(
    new URL('fixtures/0002_add_ticket_priority.stub', import.meta.url),
    new URL('0002_add_ticket_priority.stub', stubs),
  )

  return defineMigrations<ModelRole>({
    ...INBOX_MIGRATIONS,
    stubsRoot: fileURLToPath(new URL('..', stubs)),
    entries: [
      ...INBOX_MIGRATIONS.entries,
      { id: '0002', name: 'add_ticket_priority', columns: { ticket: ['priority'] } },
    ],
  })
}

async function migrationsOf(root: URL) {
  const directory = new URL('database/migrations/', root)
  const files = (await readdir(directory)).sort()

  return Promise.all(
    files.map(async file => ({ file, contents: await readFile(new URL(file, directory), 'utf8') })),
  )
}

const timestampOf = (file: string) => Number(file.split('_')[0])

async function schemaReport(root: URL, manifest: MigrationManifest<ModelRole>) {
  const { stdout } = await run(
    'node',
    [
      '--import=@poppinss/ts-exec',
      fileURLToPath(new URL('fixtures/schema_report.ts', import.meta.url)),
      root.href,
      JSON.stringify(manifest),
    ],
    { cwd: new URL('..', import.meta.url) },
  )

  // SAFETY: the script prints this shape, and the assertions below fail on any other.
  return JSON.parse(stdout) as {
    columns: Record<string, string[]>
    error: { code: string; message: string } | null
  }
}

test.group('migrations', group => {
  // A copy's migration:fresh drops every table on a shared pg database, so the playground's own
  // tables come back for the groups after this one.
  group.teardown(() => migrateApp(playground))

  test('a fresh app gets every migration in manifest order, after its own', async ({
    assert,
    cleanup,
  }) => {
    const copy = await copyApp(playground, withoutInbox)
    cleanup(copy.remove)
    const manifest = await manifestWithPriority(copy.root)
    const before = await migrationsOf(copy.root)

    const published = await publishMigrations(await appAt(copy.root), manifest)

    assert.deepEqual(
      published.map(({ entry }) => entry.id),
      ['0001', '0002'],
    )

    const added = (await migrationsOf(copy.root)).slice(before.length)

    assert.match(added[0]!.file, /^\d+_inbox_0001_create_inbox_tables\.ts$/)
    assert.match(added[1]!.file, /^\d+_inbox_0002_add_ticket_priority\.ts$/)
    assert.isAbove(timestampOf(added[0]!.file), timestampOf(before.at(-1)!.file))
    assert.isAbove(timestampOf(added[1]!.file), timestampOf(added[0]!.file))

    const stub = await readFile(`${stubsRoot}/migrations/0001_create_inbox_tables.stub`, 'utf8')
    assert.equal(added[0]!.contents, stub.slice(stub.indexOf('}}}\n') + 4).trimEnd())
  })

  test('an app that has 0001, edited, gets only 0002 and keeps its file', async ({
    assert,
    cleanup,
  }) => {
    const copy = await copyApp(playground, withoutInbox)
    cleanup(copy.remove)
    const manifest = await manifestWithPriority(copy.root)
    const edited = '// tenant_id added by the host\nexport default class {}\n'

    await writeFile(
      new URL('database/migrations/1800000000000_inbox_0001_create_inbox_tables.ts', copy.root),
      edited,
    )

    const published = await publishMigrations(await appAt(copy.root), manifest)

    assert.deepEqual(
      published.map(({ entry }) => entry.id),
      ['0002'],
    )

    const files = await migrationsOf(copy.root)
    const host = files.find(({ file }) => file.startsWith('1800000000000_'))
    const added = files.find(({ file }) => file.includes('_inbox_0002_'))

    assert.equal(host?.contents, edited)
    assert.isAbove(timestampOf(added!.file), 1800000000000)
  })

  test('publishing again writes nothing', async ({ assert, cleanup }) => {
    const copy = await copyApp(playground, withoutInbox)
    cleanup(copy.remove)
    const manifest = await manifestWithPriority(copy.root)
    const app = await appAt(copy.root)

    await publishMigrations(app, manifest)
    const first = await migrationsOf(copy.root)

    assert.deepEqual(await publishMigrations(app, manifest), [])
    assert.deepEqual(await migrationsOf(copy.root), first)
  })

  test('the published migrations apply, and the schema check follows them', async ({
    assert,
    cleanup,
  }) => {
    const copy = await copyApp(playground, withoutInbox)
    cleanup(() => {
      ace(copy.root, 'migration:reset', '--force')

      return copy.remove()
    })
    const manifest = await manifestWithPriority(copy.root)
    const app = await appAt(copy.root)

    await publishMigrations(app, { ...manifest, entries: manifest.entries.slice(0, 1) })
    const baseline = ace(copy.root, 'migration:fresh', '--force')
    assert.equal(baseline.exitCode, 0, baseline.output)

    const behind = await schemaReport(copy.root, manifest)
    assert.equal(behind.error?.code, 'E_INBOX_SCHEMA_OUTDATED')
    assert.include(behind.error?.message, 'priority')
    assert.include(behind.error?.message, '0002_add_ticket_priority')
    assert.include(behind.error?.message, 'node ace inbox:migrations')

    assert.deepEqual(
      (await publishMigrations(app, manifest)).map(({ entry }) => entry.id),
      ['0002'],
    )
    const upgrade = ace(copy.root, 'migration:run', '--force')
    assert.equal(upgrade.exitCode, 0, upgrade.output)

    const current = await schemaReport(copy.root, manifest)
    assert.isNull(current.error)

    for (const role of MODEL_ROLES) {
      const listed = manifest.entries.flatMap(entry => entry.columns[role] ?? [])

      assert.deepEqual(
        current.columns[role],
        listed.sort(),
        `the manifest lists every ${role} column`,
      )
    }
  })

  test('inbox:migrations publishes what the app lacks, once, and --check tells', async ({
    assert,
    cleanup,
  }) => {
    const copy = await copyApp(playground, withoutInbox)
    cleanup(() => {
      ace(copy.root, 'migration:reset', '--force')

      return copy.remove()
    })

    const lacking = ace(copy.root, 'inbox:migrations', '--check')
    assert.equal(lacking.exitCode, 1)
    assert.include(lacking.output, '0001_create_inbox_tables')

    const publish = ace(copy.root, 'inbox:migrations')
    assert.equal(publish.exitCode, 0, publish.output)
    assert.match(
      publish.output,
      /create database\/migrations\/\d+_inbox_0001_create_inbox_tables\.ts/,
    )
    const published = await migrationsOf(copy.root)

    const again = ace(copy.root, 'inbox:migrations')
    assert.include(again.output, 'has every migration')
    assert.deepEqual(await migrationsOf(copy.root), published)
    assert.equal(ace(copy.root, 'inbox:migrations', '--check').exitCode, 0)

    const migrate = ace(copy.root, 'migration:fresh', '--force')
    assert.equal(migrate.exitCode, 0, migrate.output)

    const tick = ace(copy.root, 'inbox:tick')
    assert.equal(tick.exitCode, 0, tick.output)
  })

  test('configure publishes every inbox migration a fresh app lacks', async ({
    assert,
    cleanup,
  }) => {
    const copy = await copyApp(playground, withoutInbox)
    cleanup(copy.remove)

    const configure = ace(copy.root, 'configure', '@enzopita/adonisjs-inbox')
    assert.equal(configure.exitCode, 0, configure.output)

    const added = (await migrationsOf(copy.root)).filter(({ file }) => file.includes('_inbox_'))
    assert.match(added[0]?.file ?? '', /^\d+_inbox_0001_create_inbox_tables\.ts$/)
    assert.lengthOf(added, INBOX_MIGRATIONS.entries.length)
  })

  test('the inbox refuses a model whose schema lacks a column', async ({ assert, cleanup }) => {
    class OutdatedSchema extends BaseModel {
      @column({ isPrimary: true })
      declare id: number
    }

    class Ticket extends compose(OutdatedSchema, withInboxTicket()) {
      static table = 'inbox_tickets'
    }

    const app = await boot(
      defineConfig({
        models: { ...playgroundModels(), ticket: async () => ({ default: Ticket }) },
        bots: {},
        channels: {},
      }),
    )

    cleanup(() => app.terminate())

    const inbox = await app.container.make('inbox')

    const error = await inbox.model('ticket').then(
      () => null,
      (thrown: Error) => thrown,
    )

    assert.instanceOf(error, InboxError)
    assert.propertyVal(error, 'code', 'E_INBOX_SCHEMA_OUTDATED')
    assert.include(error?.message, 'version')
    assert.instanceOf(await inbox.model('queue'), Function)
  })

  test('the playground has every inbox migration', async ({ assert }) => {
    const check = ace(playground, 'inbox:migrations', '--check')

    assert.equal(check.exitCode, 0, check.output)
  })
})
