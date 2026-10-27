import type { CommandMetaData } from '@adonisjs/core/types/ace'
import CheckOpenApi from './check_openapi.ts'
import GenerateOpenApi from './generate_openapi.ts'

const commands = [
  { command: GenerateOpenApi, filePath: 'generate_openapi.js' },
  { command: CheckOpenApi, filePath: 'check_openapi.js' },
]

export async function getMetaData(): Promise<CommandMetaData[]> {
  return commands.map(({ command, filePath }) => ({ ...command.serialize(), filePath }))
}

export async function getCommand(metaData: CommandMetaData) {
  return (
    commands.find(({ command }) => command.commandName === metaData.commandName)?.command ?? null
  )
}
