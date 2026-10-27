import { Exception } from '@adonisjs/core/exceptions'
import type { HttpContext } from '@adonisjs/core/http'

/**
 * Another account uses this email address
 */
export default class EmailTakenException extends Exception {
  static override code = 'E_EMAIL_TAKEN'

  constructor(public email: string) {
    super(`An account with ${email} already exists`)
  }

  async handle(error: this, { response }: HttpContext) {
    response.conflict({ code: 'E_EMAIL_TAKEN' as const, message: error.message })
  }
}
