import type { CommandMetaData } from '@adonisjs/core/types/ace'

import FlowsMigrations from './flows_migrations.ts'
import FlowsTick from './flows_tick.ts'

const COMMANDS = [
  { command: FlowsMigrations, filePath: 'flows_migrations.js' },
  { command: FlowsTick, filePath: 'flows_tick.js' },
]

export async function getMetaData(): Promise<CommandMetaData[]> {
  return COMMANDS.map(({ command, filePath }) => ({ ...command.serialize(), filePath }))
}

export async function getCommand(metaData: CommandMetaData) {
  return (
    COMMANDS.find(({ command }) => command.commandName === metaData.commandName)?.command ?? null
  )
}
