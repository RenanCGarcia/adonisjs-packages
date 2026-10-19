export const MODEL_ROLES = [
  'attendant',
  'channel',
  'channelEvent',
  'contact',
  'conversation',
  'message',
  'queue',
  'queueMember',
  'ticket',
  'ticketEvent',
] as const

export type ModelRole = (typeof MODEL_ROLES)[number]
