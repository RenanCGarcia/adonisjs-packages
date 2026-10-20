import { configProvider } from '@adonisjs/core'
import type { ApplicationService } from '@adonisjs/core/types'
import type {} from '@adonisjs/lucid/database_provider'

import type { ResolvedInboxConfig } from '../src/define_config.ts'
import { InboxError } from '../src/errors.ts'
import { Inbox } from '../src/inbox.ts'
import type { InboxEvents } from '../src/types.ts'

declare module '@adonisjs/core/types' {
  interface ContainerBindings {
    inbox: Inbox
  }

  interface EventsList extends InboxEvents {}
}

export default class InboxProvider {
  constructor(protected app: ApplicationService) {}

  register() {
    this.app.container.singleton('inbox', async () => {
      const config = await configProvider.resolve<ResolvedInboxConfig>(
        this.app,
        this.app.config.get('inbox'),
      )

      if (config === null) {
        throw new InboxError(
          'E_INBOX_INVALID_CONFIG',
          'inbox: config/inbox.ts must export the result of defineConfig()',
        )
      }

      return new Inbox(
        config,
        await this.app.container.make('lucid.db'),
        await this.app.container.make('emitter'),
        await this.app.container.make('logger'),
      )
    })
  }

  /**
   * Making the service here fails the boot on a broken config. Models are imported on first
   * use, so ace commands never load app code through it.
   */
  async boot() {
    await this.app.container.make('inbox')
  }

  async shutdown() {
    const inbox = await this.app.container.make('inbox')

    inbox.close()
  }
}
