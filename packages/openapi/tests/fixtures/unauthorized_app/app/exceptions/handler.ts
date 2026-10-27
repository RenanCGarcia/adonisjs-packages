import { errors as authErrors } from '@adonisjs/auth'
import { type HttpContext, ExceptionHandler } from '@adonisjs/core/http'

export default class HttpExceptionHandler extends ExceptionHandler {
  async handle(error: unknown, ctx: HttpContext) {
    if (error instanceof authErrors.E_UNAUTHORIZED_ACCESS) {
      return ctx.response.unauthorized({
        code: 'E_UNAUTHORIZED_ACCESS' as const,
        message: error.message,
      })
    }

    return super.handle(error, ctx)
  }
}
