import vine from '@vinejs/vine'

export const queueValidator = vine.create({
  name: vine.string().trim().minLength(1),
})

export const memberValidator = vine.create({
  userId: vine.number().withoutDecimals().min(1),
})

export const channelValidator = vine.create({
  queueId: vine.number().withoutDecimals().min(1),
  provider: vine.enum(['fake', 'triage']).optional(),
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
