import app from '@adonisjs/core/services/app'
import { errors as bouncerErrors } from '@adonisjs/bouncer'
import { errors as limiterErrors } from '@adonisjs/limiter'
import type { Exception } from '@adonisjs/core/exceptions'
import { type HttpContext, ExceptionHandler } from '@adonisjs/core/http'
import PlanLimitException from '#exceptions/plan_limit_exception'
import SeatLimitException from '#exceptions/seat_limit_exception'
import MaintenanceException from '#exceptions/maintenance_exception'
import DisposableEmailException from '#exceptions/disposable_email_exception'

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
    // A policy's `deny(message, status)` sets the status on `error.response`, as bouncer's own handle() reads it.
    if (error instanceof bouncerErrors.E_AUTHORIZATION_FAILURE) {
      return ctx.response.status(error.response.status || error.status).send({
        code: 'E_AUTHORIZATION_FAILURE' as const,
        message: error.getResponseMessage(ctx),
      })
    }

    if (error instanceof limiterErrors.E_TOO_MANY_REQUESTS) {
      return ctx.response.status(error.status).send({
        code: 'E_TOO_MANY_REQUESTS' as const,
        message: error.getResponseMessage(ctx),
        retryAfter: error.response.availableIn,
      })
    }

    if (error instanceof PlanLimitException || error instanceof SeatLimitException) {
      return ctx.response.status(error.status).send({
        code: error.code ?? 'E_LIMIT',
        message: error.message,
        upgradeUrl: '/billing',
      })
    }

    if (
      error instanceof DisposableEmailException &&
      ctx.request.header('x-hide-domain') === 'true'
    ) {
      return ctx.response.status(error.status).send({
        code: 'E_DISPOSABLE_EMAIL' as const,
        message: 'Use another email address',
      })
    }

    // Sends nothing, so super.handle() renders the body.
    if (error instanceof MaintenanceException) {
      ctx.response.header('Retry-After', '300')
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
