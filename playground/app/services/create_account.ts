import User from '#models/user'
import EmailTakenException from '#exceptions/email_taken_exception'

export async function createAccount(data: Pick<User, 'fullName' | 'email' | 'password'>) {
  if (await User.findBy('email', data.email)) throw new EmailTakenException(data.email)

  return User.create(data)
}
