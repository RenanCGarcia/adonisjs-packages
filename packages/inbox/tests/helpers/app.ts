import { execFile } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'

import { IgnitorFactory } from '@adonisjs/core/factories'
import type { ApplicationService } from '@adonisjs/core/types'
import { defineConfig as defineDatabaseConfig } from '@adonisjs/lucid'

import type { defineConfig, InboxModels } from '../../src/define_config.ts'

const playground = new URL('../../../../playground/', import.meta.url)
const run = promisify(execFile)

const model =
  <T>(path: string): (() => Promise<{ default: T }>) =>
  () =>
    import(new URL(`app/models/inbox/${path}.ts`, playground).href)

export function playgroundModels(): InboxModels {
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

export async function migratePlayground() {
  await run('node', ['ace', 'migration:run', '--force', '--no-schema-generate'], {
    cwd: playground,
  })
}

/**
 * Boots the playground in this process with the inbox provider and `inboxConfig`, so a spec can
 * land a write between another write's read and its commit.
 */
export async function boot(inboxConfig: ReturnType<typeof defineConfig>) {
  const app: ApplicationService = new IgnitorFactory()
    .withCoreProviders()
    .withCoreConfig()
    .merge({
      rcFileContents: {
        providers: [
          () => import('@adonisjs/lucid/database_provider'),
          () => import('../../providers/inbox_provider.ts'),
        ],
      },
      config: {
        database: defineDatabaseConfig({
          connection: 'sqlite',
          connections: {
            sqlite: {
              client: 'better-sqlite3',
              connection: { filename: fileURLToPath(new URL('tmp/db.sqlite3', playground)) },
              useNullAsDefault: true,
            },
          },
        }),
        inbox: inboxConfig,
      },
    })
    .create(playground, { importer: filePath => import(filePath) })
    .createApp('web')

  await app.init()
  await app.boot()

  return app
}
