export const FLOWS_MODEL_ROLES = [
  'flow',
  'flowVersion',
  'flowBinding',
  'flowRun',
  'flowEffect',
] as const

export type FlowsModelRole = (typeof FLOWS_MODEL_ROLES)[number]
