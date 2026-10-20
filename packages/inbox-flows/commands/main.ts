import type { CommandMetaData } from '@adonisjs/core/types/ace'

import FlowsTick from './flows_tick.ts'

export async function getMetaData(): Promise<CommandMetaData[]> {
  return [{ ...FlowsTick.serialize(), filePath: 'flows_tick.js' }]
}

export async function getCommand(metaData: CommandMetaData) {
  return metaData.commandName === FlowsTick.commandName ? FlowsTick : null
}
