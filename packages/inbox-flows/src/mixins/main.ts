import type { FlowsModelRole } from '../models.ts'
import { withInboxFlow, type InboxFlowModel } from './flow.ts'
import { withInboxFlowBinding, type InboxFlowBindingModel } from './flow_binding.ts'
import { withInboxFlowEffect, type InboxFlowEffectModel } from './flow_effect.ts'
import { withInboxFlowRun, type InboxFlowRunModel } from './flow_run.ts'
import { withInboxFlowVersion, type InboxFlowVersionModel } from './flow_version.ts'
import type { Model } from './model.ts'

export {
  withInboxFlow,
  withInboxFlowBinding,
  withInboxFlowEffect,
  withInboxFlowRun,
  withInboxFlowVersion,
}

export type { InboxFlowModel, InboxFlowRow } from './flow.ts'

export type { InboxFlowBindingModel, InboxFlowBindingRow } from './flow_binding.ts'

export type { EffectStatus, InboxFlowEffectModel, InboxFlowEffectRow } from './flow_effect.ts'

export type { InboxFlowRunModel, InboxFlowRunRow } from './flow_run.ts'

export type { InboxFlowVersionModel, InboxFlowVersionRow } from './flow_version.ts'

export type { FlowsModel } from './model.ts'

/**
 * The mixin each model role needs, checked to cover every role and to tag each with its own.
 */
export const INBOX_FLOWS_MIXINS = {
  flow: withInboxFlow,
  flowVersion: withInboxFlowVersion,
  flowBinding: withInboxFlowBinding,
  flowRun: withInboxFlowRun,
  flowEffect: withInboxFlowEffect,
} satisfies {
  [R in FlowsModelRole]: () => (superclass: Model) => { readonly inboxFlowsRole: R }
}

export interface FlowsModelsByRole {
  flow: InboxFlowModel
  flowVersion: InboxFlowVersionModel
  flowBinding: InboxFlowBindingModel
  flowRun: InboxFlowRunModel
  flowEffect: InboxFlowEffectModel
}

export type FlowsModelOf<R extends FlowsModelRole> = FlowsModelsByRole[R]
