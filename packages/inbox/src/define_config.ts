import { configProvider } from '@adonisjs/core'
import type { ApplicationService, ConfigProvider } from '@adonisjs/core/types'

import type { AdapterProvider, ChannelAdapter } from './adapters/port.ts'
import { AdapterRegistry } from './adapters/registry.ts'
import { InboxError } from './errors.ts'
import type { InboxModelOf } from './mixins/main.ts'
import { MODEL_ROLES, type ModelRole } from './models.ts'
import { tasks, type TaskDriverFactory } from './tasks.ts'
import type { Actor, Gesture, TicketSnapshot } from './types.ts'

type Lazy<T> = () => Promise<{ default: T }>

/**
 * One slot per model role, each demanding the role's mixin, so leaving a model out or pointing a
 * slot at a model without its mixin fails to compile.
 */
export type InboxModels = { [R in ModelRole]: Lazy<InboxModelOf<R>> }

type ChannelOf<Models extends InboxModels> = InstanceType<
  Awaited<ReturnType<Models['channel']>>['default']
>

export interface AuthorizeQuestion {
  actor: Actor
  operation: Gesture | { gesture: 'send' }
  ticket: TicketSnapshot
}

/**
 * Column values, by attribute name, merged into the rows the package creates from a channel.
 */
export type Ownership = Partial<Record<string, string | number | null>>

export interface InboxConfig<Models extends InboxModels, Bots extends readonly string[]> {
  models: Models

  /**
   * Keys of the bot attendants. `inbox.attendants.bot(key)` only accepts these.
   */
  bots: Bots

  /**
   * The adapter of each provider, keyed by the `provider` column of your channels.
   */
  channels: Record<string, AdapterProvider>

  /**
   * Where the work after a commit runs: ingesting a webhook and dispatching a message. Defaults
   * to `tasks.inline()`.
   */
  tasks?: TaskDriverFactory

  /**
   * The address a contact is stored and reached under, such as a phone number without the
   * formatting a provider adds. Two webhooks whose addresses map to one key are one contact.
   * Defaults to the address as the provider sent it.
   */
  contactKey?: (address: string, provider: string) => string

  /**
   * Your permission rules for `inbox.tickets.apply` and `inbox.messages.send`, which asks with
   * the operation `{ gesture: 'send' }`. It runs against the freshly read ticket on
   * every attempt, and `false` comes back as `{ outcome: 'rejected', reason: 'forbidden' }`.
   * Releases the package does itself, when an attendant is deactivated or leaves a queue, skip it,
   * because an inactive or departed attendant must not keep a ticket.
   */
  authorize?: (question: AuthorizeQuestion) => boolean | Promise<boolean>

  /**
   * Fills your own columns, such as a `tenantId`, on every contact, conversation, ticket and
   * message the inbox creates from this channel. The values go through `Model.create`, so your
   * model hooks still run.
   */
  ownership?: (channel: ChannelOf<Models>) => Ownership
}

export interface ResolvedInboxConfig {
  bots: ReadonlySet<string>
  model<R extends ModelRole>(role: R): Promise<InboxModelOf<R>>
  authorize: (question: AuthorizeQuestion) => boolean | Promise<boolean>
  ownership: (channel: InstanceType<InboxModelOf<'channel'>>) => Ownership
  adapters: AdapterRegistry
  tasks: TaskDriverFactory
  contactKey: (address: string, provider: string) => string
}

export type InferBots<T extends { bots: readonly string[] }> = { [K in T['bots'][number]]: true }

export function defineConfig<
  const Models extends InboxModels,
  const Bots extends readonly string[],
>(config: InboxConfig<Models, Bots>): ConfigProvider<ResolvedInboxConfig> & { bots: Bots } {
  return { ...configProvider.create(async app => resolve(config, app)), bots: config.bots }
}

async function resolve(
  config: InboxConfig<InboxModels, readonly string[]>,
  app: ApplicationService,
): Promise<ResolvedInboxConfig> {
  const missing = MODEL_ROLES.filter(role => config.models[role] === undefined)

  if (missing.length > 0) {
    throw new InboxError(
      'E_INBOX_INVALID_CONFIG',
      `inbox: config.models is missing ${missing.join(', ')}`,
    )
  }

  const adapters = new Map<string, ChannelAdapter>()

  for (const [provider, adapter] of Object.entries(config.channels)) {
    const resolved = await configProvider.resolve<ChannelAdapter>(app, adapter)

    if (resolved === null) {
      throw new InboxError(
        'E_INBOX_INVALID_CONFIG',
        `inbox: config.channels.${provider} must be an adapter, such as adapters.fake()`,
      )
    }

    adapters.set(provider, resolved)
  }

  return {
    bots: new Set(config.bots),
    async model(role) {
      const { default: model } = await config.models[role]()

      if (model.inboxRole !== role) {
        throw new InboxError(
          'E_INBOX_INVALID_CONFIG',
          `inbox: config.models.${role} is a model without the ${role} mixin from @enzopita/adonisjs-inbox/mixins`,
        )
      }

      return model
    },
    authorize: config.authorize ?? (() => true),
    ownership: config.ownership ?? (() => ({})),
    adapters: new AdapterRegistry(adapters),
    tasks: config.tasks ?? tasks.inline(),
    contactKey: config.contactKey ?? (address => address),
  }
}
