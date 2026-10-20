import { configProvider } from '@adonisjs/core'
import type { ApplicationService } from '@adonisjs/core/types'
import type {} from '@adonisjs/lucid/database_provider'
import type {} from '@enzopita/adonisjs-inbox/inbox_provider'

import type { ResolvedFlowsConfig } from '../src/define_config.ts'
import { InboxFlowsError } from '../src/errors.ts'
import { InboxFlows } from '../src/inbox_flows.ts'
import { FlowsRuntime } from '../src/runtime.ts'

declare module '@adonisjs/core/types' {
  interface ContainerBindings {
    inboxFlows: InboxFlows
  }
}

/**
 * Register it after the inbox's provider.
 */
export default class InboxFlowsProvider {
  constructor(protected app: ApplicationService) {}

  register() {
    this.app.container.singleton(FlowsRuntime, async resolver => {
      const config = await configProvider.resolve<ResolvedFlowsConfig>(
        this.app,
        this.app.config.get('inbox_flows'),
      )

      if (config === null) {
        throw new InboxFlowsError(
          'E_INBOX_FLOWS_INVALID_CONFIG',
          'inbox-flows: config/inbox_flows.ts must export the result of defineConfig()',
        )
      }

      return new FlowsRuntime(
        config,
        await resolver.make('inbox'),
        await resolver.make('lucid.db'),
        this.app.container,
        await resolver.make('logger'),
      )
    })

    this.app.container.singleton('inboxFlows', async resolver => {
      return new InboxFlows(await resolver.make(FlowsRuntime))
    })
  }

  /**
   * Making the service here fails the boot on a broken config. Every ticket change asks whether
   * it ended a run, such as a person answering a contact the bot was asking something.
   */
  async boot() {
    const flows = await this.app.container.make('inboxFlows')
    const emitter = await this.app.container.make('emitter')
    const logger = await this.app.container.make('logger')

    emitter.on('inbox:ticket_changed', async ({ ticketId }) => {
      try {
        await flows.reconcile(ticketId)
      } catch (error) {
        logger.error({ err: error, ticketId }, 'inbox-flows: reconciling a run failed')
      }
    })
  }
}
