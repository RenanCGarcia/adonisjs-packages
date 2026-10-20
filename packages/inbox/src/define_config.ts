import { configProvider } from '@adonisjs/core'
import type { ApplicationService, ConfigProvider } from '@adonisjs/core/types'

import type { AdapterProvider, ChannelAdapter } from './adapters/port.ts'
import { AdapterRegistry } from './adapters/registry.ts'
import type { Automation } from './automations.ts'
import type { Bot, BotLoader } from './bots.ts'
import { InboxError } from './errors.ts'
import { assertSchema } from './migrations.ts'
import type { InboxModelOf } from './mixins/main.ts'
import { MODEL_ROLES, type ModelRole } from './models.ts'
import { INBOX_MIGRATIONS } from './schema.ts'
import { tasks, type TaskDriverFactory } from './tasks.ts'
import type { Actor, Gesture, JsonValue, TicketSnapshot } from './types.ts'

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

export interface InboxConfig<Models extends InboxModels, Bots extends Record<string, BotLoader>> {
  models: Models

  /**
   * The bot attendants, by key, each a lazily imported class implementing `Bot`.
   * `inbox.attendants.bot(key)` and the automations only accept these keys.
   */
  bots: Bots

  /**
   * Run on their trigger, in order. Each sees the ticket the ones before it left.
   */
  automations?: ReadonlyArray<Automation<NoInfer<Extract<keyof Bots, string>>>>

  /**
   * The adapter of each provider, keyed by the `provider` column of your channels.
   */
  channels: Record<string, AdapterProvider>

  /**
   * Where the work after a commit runs: ingesting a webhook, dispatching a message and running a
   * bot turn. Defaults to `tasks.inline()`.
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
   * Fills your own columns, such as a `tenantId`, on every row the inbox creates from this
   * channel: its webhooks, contacts, conversations, tickets, ticket events and messages. The
   * values go through `Model.create`, so your model hooks still run.
   */
  ownership?: (channel: ChannelOf<Models>) => Ownership
}

export interface ResolvedInboxConfig {
  /**
   * Each bot, made through the container on first use.
   */
  bots: ReadonlyMap<string, () => Promise<Bot<JsonValue>>>
  automations: ReadonlyArray<Automation<string>>
  model<R extends ModelRole>(role: R): Promise<InboxModelOf<R>>
  authorize: (question: AuthorizeQuestion) => boolean | Promise<boolean>
  ownership: (channel: InstanceType<InboxModelOf<'channel'>>) => Ownership
  adapters: AdapterRegistry
  tasks: TaskDriverFactory
  contactKey: (address: string, provider: string) => string
}

export type InferBots<T extends { bots: object }> = { [K in keyof T['bots']]: true }

export function defineConfig<
  const Models extends InboxModels,
  const Bots extends Record<string, BotLoader>,
>(config: InboxConfig<Models, Bots>): ConfigProvider<ResolvedInboxConfig> & { bots: Bots } {
  return { ...configProvider.create(async app => resolve(config, app)), bots: config.bots }
}

async function resolve<Bots extends Record<string, BotLoader>>(
  config: InboxConfig<InboxModels, Bots>,
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

  const bots = new Map<string, () => Promise<Bot<JsonValue>>>()

  for (const [key, loader] of Object.entries(config.bots)) {
    let made: Promise<Bot<JsonValue>> | undefined

    bots.set(
      key,
      () =>
        (made ??= loader()
          .then(({ default: BotClass }) => app.container.make(BotClass))
          .catch(error => {
            made = undefined
            throw error
          })),
    )
  }

  return {
    bots,
    automations: config.automations ?? [],
    async model(role) {
      const { default: model } = await config.models[role]()

      if (model.inboxRole !== role) {
        throw new InboxError(
          'E_INBOX_INVALID_CONFIG',
          `inbox: config.models.${role} is a model without the ${role} mixin from @enzopita/adonisjs-inbox/mixins`,
        )
      }

      assertSchema(INBOX_MIGRATIONS, role, model)

      return model
    },
    authorize: config.authorize ?? (() => true),
    ownership: config.ownership ?? (() => ({})),
    adapters: new AdapterRegistry(adapters),
    tasks: config.tasks ?? tasks.inline(),
    contactKey: config.contactKey ?? (address => address),
  }
}
