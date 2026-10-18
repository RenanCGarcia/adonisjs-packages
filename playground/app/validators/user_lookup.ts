import vine from '@vinejs/vine'

export const listUsersValidator = vine.create({
  page: vine.number().withoutDecimals().min(1).optional(),
  perPage: vine.number().withoutDecimals().range([1, 100]).optional(),
})

export const showUserValidator = vine.create({
  params: vine.object({
    id: vine.number().withoutDecimals().min(1),
  }),
})
