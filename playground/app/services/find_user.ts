import User from '#models/user'

export function findUser(id: number) {
  return User.findOrFail(id)
}
