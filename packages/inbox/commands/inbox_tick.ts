import { BaseCommand } from '@adonisjs/core/ace'
import type { CommandOptions } from '@adonisjs/core/types/ace'

import type {} from '../providers/inbox_provider.ts'

export default class InboxTick extends BaseCommand {
  static commandName = 'inbox:tick'
  static description =
    'Run the tick automations, and queue again the webhooks and messages lost tasks left behind'

  static options: CommandOptions = { startApp: true }

  async run() {
    const inbox = await this.app.container.make('inbox')
    const { automations, recovered } = await inbox.tick()

    for (const [name, { candidates, changed }] of Object.entries(automations)) {
      this.logger.info(`${name}: changed ${changed} of ${candidates} candidate tickets`)
    }

    this.logger.info(
      `recovered ${recovered.channelEvents} webhooks and ${recovered.messages} messages, gave up on ${recovered.gaveUp.channelEvents} webhooks and ${recovered.gaveUp.messages} messages`,
    )
  }
}
