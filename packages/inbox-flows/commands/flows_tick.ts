import { BaseCommand } from '@adonisjs/core/ace'
import type { CommandOptions } from '@adonisjs/core/types/ace'

import type {} from '../providers/inbox_flows_provider.ts'

export default class FlowsTick extends BaseCommand {
  static commandName = 'flows:tick'
  static description =
    'End flow runs whose ticket left the bot, wake runs whose wait is due, and deliver due flow effects'

  static options: CommandOptions = { startApp: true }

  async run() {
    const flows = await this.app.container.make('inboxFlows')
    const { ended, woken, effects } = await flows.tick()

    const endings = Object.entries(ended).map(([reason, count]) => `${count} ${reason}`)

    this.logger.info(`ended ${endings.length === 0 ? 'no runs' : endings.join(', ')}`)
    this.logger.info(`woke ${woken} runs`)
    this.logger.info(
      `effects: ${effects.delivered} delivered, ${effects.retried} to retry, ${effects.failed} failed`,
    )
  }
}
