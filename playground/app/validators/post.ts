import vine from '@vinejs/vine'

export const createPostValidator = vine.create({
  title: vine.string().minLength(3),
})
