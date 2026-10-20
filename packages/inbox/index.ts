export { configure } from './configure.ts'

export { adapters } from './src/adapters/main.ts'

export {
  CAPABILITIES,
  SENDS,
  type AdapterChannel,
  type AdapterProvider,
  type Capability,
  type ChannelAdapter,
  type ChannelStatus,
  type ConnectionState,
  type ConnectMethod,
  type ConnectResult,
  type ContactIdentity,
  type DeliveryStatus,
  type DisconnectReason,
  type NormalizedEvent,
  type OutgoingMessage,
  type Pairing,
  type RejectionCode,
  type SendOptions,
  type SendResult,
  type WebhookRequest,
} from './src/adapters/port.ts'

export {
  automations,
  defineAutomation,
  type Automation,
  type CandidateFilter,
  type Effect,
  type EventAutomation,
  type TickAutomation,
  type TicketMoment,
} from './src/automations.ts'

export type {
  Bot,
  BotClass,
  BotHandoff,
  BotLoader,
  BotReply,
  BotTurn,
  InboundMessage,
} from './src/bots.ts'

export {
  defineConfig,
  type AuthorizeQuestion,
  type InboxConfig,
  type InferBots,
  type Ownership,
} from './src/define_config.ts'

export { InboxError, type InboxErrorCode } from './src/errors.ts'

export type { RecoverReport, TickReport } from './src/inbox.ts'

export { MODEL_ROLES, type ModelRole } from './src/models.ts'

export {
  KIND_RULES,
  holder,
  plan,
  planOpening,
  type Plan,
  type PlanContext,
  type TicketOpening,
} from './src/ticket/plan.ts'

export { stubsRoot } from './stubs/main.ts'

export {
  DISPATCH_LEASE_MS,
  GIVE_UP_AFTER_MS,
  RECOVER_BATCH,
  SEND_TIMEOUT_MS,
  TASK_POLICY,
  tasks,
  type BotTrigger,
  type InboxQueueJob,
  type InboxTask,
  type QueueDispatch,
  type QueueDriverOptions,
  type TaskDriver,
  type TaskDriverFactory,
} from './src/tasks.ts'

export type * from './src/types.ts'
