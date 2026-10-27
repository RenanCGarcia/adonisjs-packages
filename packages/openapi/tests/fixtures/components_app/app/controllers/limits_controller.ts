import type { HttpContext } from '@adonisjs/core/http'
import BillingLimitException from '#exceptions/billing/limit_exception'
import PlanFrozenException from '#exceptions/plan_frozen_exception'
import QuotaLimitException from '#exceptions/quota/limit_exception'
import StorageLimitException from '#exceptions/storage/limit_exception'

/**
 * @tags Probe
 */
export default class LimitsController {
  async billing({ request }: HttpContext) {
    if (request.input('over')) throw new BillingLimitException()

    return { ok: true }
  }

  async storage({ request }: HttpContext) {
    if (request.input('over')) throw new StorageLimitException()

    return { ok: true }
  }

  async quota({ request }: HttpContext) {
    if (request.input('over')) throw new QuotaLimitException()

    return { ok: true }
  }

  async frozen({ request }: HttpContext) {
    if (request.input('over')) throw new PlanFrozenException()

    return { ok: true }
  }
}
