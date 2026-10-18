import type { CommandMetaData } from '@adonisjs/core/types/ace'
import GenerateOpenApi from './generate_openapi.ts'

export async function getMetaData(): Promise<CommandMetaData[]> {
  return [{ ...GenerateOpenApi.serialize(), filePath: 'generate_openapi.js' }]
}

export async function getCommand(metaData: CommandMetaData) {
  return metaData.commandName === GenerateOpenApi.commandName ? GenerateOpenApi : null
}
