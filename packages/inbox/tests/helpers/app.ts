import { defineConfig } from '../../src/define_config.ts'
import { bootApp, migrateApp, modelsIn } from '../../src/testing/main.ts'

/**
 * A host app, set up by `node ace configure @enzopita/adonisjs-inbox`.
 */
export const fixture = new URL('../fixtures/app/', import.meta.url)

export const fixtureModels = () => modelsIn(fixture)

export function fixtureBots() {
  return { triage: () => import(new URL('app/bots/triage_bot.ts', fixture).href) }
}

/**
 * The fixture's own `config/inbox.ts`, which its ace commands run with too.
 */
export async function fixtureConfig() {
  const { default: config }: { default: ReturnType<typeof defineConfig> } = await import(
    new URL('config/inbox.ts', fixture).href
  )

  return config
}

export const migrateFixture = () => migrateApp(fixture)

export const boot = (inbox: ReturnType<typeof defineConfig>) => bootApp(fixture, inbox)

/**
 * The fixture's database in this process, for reading the rows a command wrote and for writing
 * rows none would.
 */
export async function fixtureDatabase() {
  const app = await boot(defineConfig({ models: fixtureModels(), bots: {}, channels: {} }))

  return { db: await app.container.make('lucid.db'), close: () => app.terminate() }
}
