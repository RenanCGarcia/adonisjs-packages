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

/**
 * `request.validateUsing()` validates the body merged with the query string, so `query` is a
 * field like any other: `?query[page]=2` or `{ "query": { "page": 2 } }`, never `?page=2`.
 */
export const pagedProbeValidator = vine.create({
  query: vine.object({
    page: vine.number(),
  }),
})

export const nullableProbeValidator = vine.create({
  nickname: vine.string().nullable(),
  bio: vine.string().optional(),
  website: vine.string().nullable().optional(),
})
