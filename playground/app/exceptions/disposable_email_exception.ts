import { Exception } from '@adonisjs/core/exceptions'
import type { HttpContext } from '@adonisjs/core/http'

export default class DisposableEmailException extends Exception {
  static override status = 422
  static override code = 'E_DISPOSABLE_EMAIL'

  constructor(public domain: string) {
    super(`Emails from ${domain} are not accepted`)
  }

  toResponse() {
    return { code: 'E_DISPOSABLE_EMAIL' as const, message: this.message, domain: this.domain }
  }

  async handle(error: this, { response }: HttpContext) {
    response.status(error.status).send(error.toResponse())
  }
}
