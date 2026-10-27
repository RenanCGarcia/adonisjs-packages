import { manageProbe } from '#abilities/main'
import type { HttpContext } from '@adonisjs/core/http'
import type { NextFn } from '@adonisjs/core/types/http'

export default class ManagesProbeMiddleware {
  async handle({ bouncer }: HttpContext, next: NextFn) {
    await bouncer.authorize(manageProbe)

    return next()
  }
}
