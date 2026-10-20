import vine from '@vinejs/vine'

export const queueValidator = vine.create({
  name: vine.string().trim().minLength(1),
})

export const memberValidator = vine.create({
  userId: vine.number().withoutDecimals().min(1),
})

export const channelValidator = vine.create({
  queueId: vine.number().withoutDecimals().min(1),
  name: vine.string().trim().minLength(1).optional(),
  provider: vine.enum(['fake', 'triage', 'flows']).optional(),
})

export const conversationValidator = vine.create({
  address: vine.string().trim().minLength(1),
})

export const assignValidator = vine.create({
  userId: vine.number().withoutDecimals().min(1).optional().requiredIfMissing('bot'),
  bot: vine.literal('triage').optional(),
})

export const transferValidator = vine.create({
  queueId: vine.number().withoutDecimals().min(1),
  userId: vine.number().withoutDecimals().min(1).optional(),
})

export const closeValidator = vine.create({
  reason: vine.enum(['manual', 'inactivity', 'bot_completed', 'channel_removed']),
  note: vine.string().trim().optional(),
})

export const messageValidator = vine.create({
  text: vine.string().trim().minLength(1),
})

export const ticketListValidator = vine.create({
  // The query string parser splits `status=queued,closed` into an array, and leaves one status a
  // string.
  status: vine
    .array(vine.enum(['queued', 'in_progress', 'closed'] as const))
    .parse(value => (value === undefined ? value : [value].flat()))
    .optional(),
  queueId: vine.number().withoutDecimals().min(1).optional(),
  assignee: vine
    .string()
    .regex(/^([1-9]\d*|unassigned|bot)$/)
    .transform(value => (value === 'unassigned' || value === 'bot' ? value : Number(value)))
    .optional(),
  channelId: vine.number().withoutDecimals().min(1).optional(),
  search: vine.string().trim().minLength(1).optional(),
  page: vine.number().withoutDecimals().min(1).optional(),
  perPage: vine.number().withoutDecimals().range([1, 100]).optional(),
})

export const agentValidator = vine.create({
  fullName: vine.string().trim().minLength(1),
  email: vine.string().email().maxLength(254).unique({ table: 'users', column: 'email' }),
  password: vine.string().minLength(8).maxLength(32),
  queueIds: vine.array(vine.number().withoutDecimals().min(1)).optional(),
})

export const inboundValidator = vine.create({
  from: vine.string().trim().minLength(1),
  name: vine.string().trim().minLength(1).optional(),
  text: vine.string().trim().minLength(1),
})
