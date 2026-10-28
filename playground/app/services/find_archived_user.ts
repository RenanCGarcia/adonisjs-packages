import { errors } from '@adonisjs/lucid'
import User from '#models/user'

export async function findArchivedUser(id: number) {
  const user = await User.find(id)
  if (!user) throw new errors.E_ROW_NOT_FOUND(User)
  return user
}
