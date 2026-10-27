import EmailNotVerifiedException from '#exceptions/email_not_verified_exception'
import type { HttpContext } from '@adonisjs/core/http'
import type { NextFn } from '@adonisjs/core/types/http'

export default class VerifiedEmailMiddleware {
  async handle(ctx: HttpContext, next: NextFn) {
    if (ctx.request.header('x-email-verified') !== 'true') {
      throw new EmailNotVerifiedException('Verify your email first')
    }

    return next()
  }
}
