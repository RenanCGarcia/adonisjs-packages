import vine from '@vinejs/vine'

export const updateAvatarValidator = vine.create({
  avatar: vine.file({ size: '2mb', extnames: ['jpg', 'png'] }),
})
