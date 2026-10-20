import { defineConfig } from '../../src/define_config.ts'
import { bootApp, migrateApp, modelsIn } from '../../src/testing/main.ts'

const playground = new URL('../../../../playground/', import.meta.url)

export const playgroundModels = () => modelsIn(playground)

export function playgroundBots() {
  return { triage: () => import(new URL('app/bots/triage_bot.ts', playground).href) }
}

export const migratePlayground = () => migrateApp(playground)

export const boot = (inbox: ReturnType<typeof defineConfig>) => bootApp(playground, inbox)

/**
 * The playground's database in this process, for reading the rows a request or a command wrote
 * and for writing rows neither would.
 */
export async function playgroundDatabase() {
  const app = await boot(defineConfig({ models: playgroundModels(), bots: {}, channels: {} }))

  return { db: await app.container.make('lucid.db'), close: () => app.terminate() }
}
