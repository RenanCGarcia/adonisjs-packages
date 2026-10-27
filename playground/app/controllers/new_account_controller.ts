import User from '#models/user'
import { createAccount } from '#services/create_account'
import { signupValidator } from '#validators/user'
import type { HttpContext } from '@adonisjs/core/http'
import UserTransformer from '#transformers/user_transformer'
import DisposableEmailException from '#exceptions/disposable_email_exception'

const DISPOSABLE_DOMAINS = new Set(['mailinator.com', 'yopmail.com'])

/**
 * @tags Auth
 */
export default class NewAccountController {
  /**
   * @throws {DisposableEmailException}
   * @throws {EmailTakenException}
   */
  async store({ request, response, serialize }: HttpContext) {
    const { fullName, email, password } = await request.validateUsing(signupValidator)

    const domain = email.split('@')[1]!
    if (DISPOSABLE_DOMAINS.has(domain)) throw new DisposableEmailException(domain)

    const user = await createAccount({ fullName, email, password })
    const token = await User.accessTokens.create(user)

    return response.created(
      await serialize({
        user: UserTransformer.transform(user),
        token: token.value!.release(),
      }),
    )
  }
}
