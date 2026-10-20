export { configure } from './configure.ts'

export { adapters } from './src/adapters/main.ts'

export {
  CAPABILITIES,
  SENDS,
  type AdapterChannel,
  type AdapterProvider,
  type Capability,
  type ChannelAdapter,
  type ContactIdentity,
  type DeliveryStatus,
  type NormalizedEvent,
  type OutgoingMessage,
  type RejectionCode,
  type SendOptions,
  type SendResult,
  type WebhookRequest,
} from './src/adapters/port.ts'

export {
  defineConfig,
  type AuthorizeQuestion,
  type InboxConfig,
  type InferBots,
  type Ownership,
} from './src/define_config.ts'

export { InboxError, type InboxErrorCode } from './src/errors.ts'

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
  SEND_TIMEOUT_MS,
  TASK_POLICY,
  tasks,
  type InboxQueueJob,
  type InboxTask,
  type QueueDispatch,
  type QueueDriverOptions,
  type TaskDriver,
  type TaskDriverFactory,
} from './src/tasks.ts'

export type * from './src/types.ts'
