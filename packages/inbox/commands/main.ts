import type { CommandMetaData } from '@adonisjs/core/types/ace'

import InboxMigrations from './inbox_migrations.ts'
import InboxTick from './inbox_tick.ts'

const COMMANDS = [
  { command: InboxMigrations, filePath: 'inbox_migrations.js' },
  { command: InboxTick, filePath: 'inbox_tick.js' },
]

export async function getMetaData(): Promise<CommandMetaData[]> {
  return COMMANDS.map(({ command, filePath }) => ({ ...command.serialize(), filePath }))
}

export async function getCommand(metaData: CommandMetaData) {
  return (
    COMMANDS.find(({ command }) => command.commandName === metaData.commandName)?.command ?? null
  )
}
