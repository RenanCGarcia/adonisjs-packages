import { Exception } from '@adonisjs/core/exceptions'
import type { HttpContext } from '@adonisjs/core/http'

/**
 * The email address of the account is not verified
 */
export default class EmailNotVerifiedException extends Exception {
  static override code = 'E_EMAIL_NOT_VERIFIED'

  async handle(error: this, { response }: HttpContext) {
    response.forbidden({ code: 'E_EMAIL_NOT_VERIFIED' as const, message: error.message })
  }
}
