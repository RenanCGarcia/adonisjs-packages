import app from '@adonisjs/core/services/app'
import { Exception } from '@adonisjs/core/exceptions'
import { type HttpContext, ExceptionHandler } from '@adonisjs/core/http'

export default class HttpExceptionHandler extends ExceptionHandler {
  /**
   * In debug mode, the exception handler will display verbose errors
   * with pretty printed stack traces.
   */
  protected debug = !app.inProduction

  /**
   * The method is used for handling errors and returning
   * response to the client
   */
  async handle(error: unknown, ctx: HttpContext) {
    if (error instanceof Exception && error.code === 'E_FORBIDDEN') {
      return ctx.response.forbidden({ code: 'E_FORBIDDEN' as const, message: error.message })
    }

    return super.handle(error, ctx)
  }

  override async renderErrorAsJSON(error: Exception, ctx: HttpContext) {
    ctx.response
      .status(error.status)
      .send({ code: error.code ?? 'E_UNKNOWN', message: error.message })
  }

  /**
   * The method is used to report error to the logging service or
   * the a third party error monitoring service.
   *
   * @note You should not attempt to send a response from this method.
   */
  async report(error: unknown, ctx: HttpContext) {
    return super.report(error, ctx)
  }
}
