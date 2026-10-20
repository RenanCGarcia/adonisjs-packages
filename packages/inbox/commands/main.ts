import type { CommandMetaData } from '@adonisjs/core/types/ace'

import InboxTick from './inbox_tick.ts'

export async function getMetaData(): Promise<CommandMetaData[]> {
  return [{ ...InboxTick.serialize(), filePath: 'inbox_tick.js' }]
}

export async function getCommand(metaData: CommandMetaData) {
  return metaData.commandName === InboxTick.commandName ? InboxTick : null
}
