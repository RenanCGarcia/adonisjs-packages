import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

import { IgnitorFactory } from '@adonisjs/core/factories'
import type { ApplicationService, ConfigProvider } from '@adonisjs/core/types'
import type { ProviderNode } from '@adonisjs/core/types/app'

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
 * Runs the app's migrations on the connection its `config/database.ts` picks.
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
 * Boots the app in this process with Lucid on its own `config/database.ts`, the inbox provider
 * and `inbox`, so a spec can land a write between another write's read and its commit.
 */
export async function bootApp(
  appRoot: URL,
  inbox: ConfigProvider<ResolvedInboxConfig>,
  extras: BootExtras = {},
) {
  const factory = new IgnitorFactory()
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
      config: { inbox, ...extras.config },
    })

  const app: ApplicationService = factory
    .create(appRoot, { importer: filePath => import(filePath) })
    .createApp('web')

  await app.init()

  // The config file reads the app's directories, known once it is initiated. The factory hands
  // the app its config object by reference, and the app reads it at `boot`.
  const database = await import(new URL('config/database.ts', appRoot).href)
  factory.merge({ config: { database: database.default } })

  await app.boot()

  return app
}
