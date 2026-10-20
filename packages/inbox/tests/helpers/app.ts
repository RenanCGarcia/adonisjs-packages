import type { defineConfig } from '../../src/define_config.ts'
import { bootApp, migrateApp, modelsIn } from '../../src/testing/main.ts'

const playground = new URL('../../../../playground/', import.meta.url)

export const playgroundModels = () => modelsIn(playground)

export function playgroundBots() {
  return { triage: () => import(new URL('app/bots/triage_bot.ts', playground).href) }
}

export const migratePlayground = () => migrateApp(playground)

export const boot = (inbox: ReturnType<typeof defineConfig>) => bootApp(playground, inbox)
