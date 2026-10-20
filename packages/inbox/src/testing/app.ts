import { execFile } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'

import { IgnitorFactory } from '@adonisjs/core/factories'
import type { ApplicationService, ConfigProvider } from '@adonisjs/core/types'
import type { ProviderNode } from '@adonisjs/core/types/app'
import { defineConfig as defineDatabaseConfig } from '@adonisjs/lucid'

import type { InboxModels, ResolvedInboxConfig } from '../define_config.ts'

const run = promisify(execFile)

/**
 * The inbox models of an app laid out as `node ace configure` writes them, in
 * `app/models/inbox`.
 */
export function modelsIn(appRoot: URL): InboxModels {
  const model =
    <T>(path: string): (() => Promise<{ default: T }>) =>
    () =>
      import(new URL(`app/models/inbox/${path}.ts`, appRoot).href)

  return {
    attendant: model('attendant'),
    channel: model('channel'),
    channelEvent: model('channel_event'),
    contact: model('contact'),
    conversation: model('conversation'),
    message: model('message'),
    queue: model('queue'),
    queueMember: model('queue_member'),
    ticket: model('ticket'),
    ticketEvent: model('ticket_event'),
  }
}

/**
 * Runs the app's migrations against its SQLite file in `tmp/db.sqlite3`.
 */
export async function migrateApp(appRoot: URL) {
  await run('node', ['ace', 'migration:run', '--force', '--no-schema-generate'], {
    cwd: appRoot,
  })
}

/**
 * What a package building on the inbox boots with it: its providers, registered after the
 * inbox's, and its config files by name.
 */
export interface BootExtras {
  providers?: Array<ProviderNode['file']>
  config?: { [file: string]: ConfigProvider<object> }
}

/**
 * Boots the app in this process with Lucid on its SQLite file in `tmp/db.sqlite3`, the inbox
 * provider and `inbox`, so a spec can land a write between another write's read and its
 * commit.
 */
export async function bootApp(
  appRoot: URL,
  inbox: ConfigProvider<ResolvedInboxConfig>,
  extras: BootExtras = {},
) {
  const app: ApplicationService = new IgnitorFactory()
    .withCoreProviders()
    .withCoreConfig()
    .merge({
      rcFileContents: {
        providers: [
          () => import('@adonisjs/lucid/database_provider'),
          () => import('../../providers/inbox_provider.ts'),
          ...(extras.providers ?? []),
        ],
      },
      config: {
        database: defineDatabaseConfig({
          connection: 'sqlite',
          connections: {
            sqlite: {
              client: 'better-sqlite3',
              connection: { filename: fileURLToPath(new URL('tmp/db.sqlite3', appRoot)) },
              useNullAsDefault: true,
            },
          },
        }),
        inbox,
        ...extras.config,
      },
    })
    .create(appRoot, { importer: filePath => import(filePath) })
    .createApp('web')

  await app.init()
  await app.boot()

  return app
}
