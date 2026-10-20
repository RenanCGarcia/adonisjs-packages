import { configProvider } from '@adonisjs/core'
import type { ConfigProvider } from '@adonisjs/core/types'
import type { BotKey, CloseReason } from '@enzopita/adonisjs-inbox'
import { assertSchema } from '@enzopita/adonisjs-inbox/migrations'
import { Duration, type DurationLike } from 'luxon'

import type { NodeRegistry, NodeType } from './define.ts'
import { InboxFlowsError } from './errors.ts'
import type { FlowGraph, Problem } from './graph/types.ts'
import { DEFAULT_MAX_STEPS } from './interpreter.ts'
import type { FlowsModelOf } from './mixins/main.ts'
import { FLOWS_MODEL_ROLES, type FlowsModelRole } from './models.ts'
import { FLOWS_MIGRATIONS } from './schema.ts'
import type { FlowId } from './types.ts'

type Lazy<T> = () => Promise<{ default: T }>

/**
 * One slot per model role, each demanding the role's mixin, as the inbox's `models` does.
 */
export type FlowsModels = { [R in FlowsModelRole]: Lazy<FlowsModelOf<R>> }

export interface PublishCheck {
  flowId: FlowId
  /**
   * The draft as it would be published, with every node at its current type version.
   */
  graph: FlowGraph
}

export interface InboxFlowsConfig<Nodes extends readonly NodeType[]> {
  /**
   * The `config.bots` key of `config/inbox.ts` that runs every flow, registered there as
   * `() => import('@enzopita/adonisjs-inbox-flows/bot')`.
   */
  bot: BotKey

  models: FlowsModels

  /**
   * `defineNodes([...builtins, ...yours])`.
   */
  nodes: NodeRegistry<Nodes>

  /**
   * Nodes one turn runs at most before the run ends `step_budget_exhausted`. Defaults to 50.
   */
  maxSteps?: number

  /**
   * How long the bot waits for more messages before answering. Defaults to one second.
   */
  debounce?: DurationLike

  /**
   * The close reasons a `close_reason` field may name. Close reasons are a type the host
   * augments, so the package can't list them itself. Defaults to the inbox's own four.
   */
  closeReasons?: readonly CloseReason[]

  /**
   * How long a manual start waits for its assign before the tick gives up on it. Defaults to two
   * minutes.
   */
  startDeadline?: DurationLike

  /**
   * Your own publish rules, such as "this queue belongs to the flow's tenant". Their problems
   * block the publish like the package's.
   */
  validatePublish?: (check: PublishCheck) => Problem[] | Promise<Problem[]>
}

export interface ResolvedFlowsConfig {
  bot: BotKey
  nodes: NodeRegistry<readonly NodeType[]>
  maxSteps: number
  debounce: DurationLike
  closeReasons: ReadonlySet<string>
  startDeadlineMs: number
  validatePublish: (check: PublishCheck) => Problem[] | Promise<Problem[]>
  model<R extends FlowsModelRole>(role: R): Promise<FlowsModelOf<R>>
}

const INBOX_CLOSE_REASONS: readonly CloseReason[] = [
  'manual',
  'inactivity',
  'bot_completed',
  'channel_removed',
]

export function defineConfig<const Nodes extends readonly NodeType[]>(
  config: InboxFlowsConfig<Nodes>,
): ConfigProvider<ResolvedFlowsConfig> {
  return configProvider.create(async () => resolve(config))
}

function resolve<Nodes extends readonly NodeType[]>(
  config: InboxFlowsConfig<Nodes>,
): ResolvedFlowsConfig {
  const missing = FLOWS_MODEL_ROLES.filter(role => config.models[role] === undefined)

  if (missing.length > 0) {
    throw new InboxFlowsError(
      'E_INBOX_FLOWS_INVALID_CONFIG',
      `inbox-flows: config.models is missing ${missing.join(', ')}`,
    )
  }

  return {
    bot: config.bot,
    nodes: config.nodes,
    maxSteps: config.maxSteps ?? DEFAULT_MAX_STEPS,
    debounce: config.debounce ?? { seconds: 1 },
    closeReasons: new Set(config.closeReasons ?? INBOX_CLOSE_REASONS),
    startDeadlineMs: Duration.fromDurationLike(config.startDeadline ?? { minutes: 2 }).toMillis(),
    validatePublish: config.validatePublish ?? (() => []),
    async model(role) {
      const { default: model } = await config.models[role]()

      if (model.inboxFlowsRole !== role) {
        throw new InboxFlowsError(
          'E_INBOX_FLOWS_INVALID_CONFIG',
          `inbox-flows: config.models.${role} is a model without the ${role} mixin from @enzopita/adonisjs-inbox-flows/mixins`,
        )
      }

      assertSchema(FLOWS_MIGRATIONS, role, model)

      return model
    },
  }
}
