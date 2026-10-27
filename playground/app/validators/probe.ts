import vine from '@vinejs/vine'

export const searchProbeValidator = vine.create({
  filter: vine
    .object({
      status: vine.enum(['active', 'disabled']).optional(),
    })
    .optional(),
})

export const echoProbeValidator = vine.create({
  message: vine.string(),
})
