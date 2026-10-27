import type { HttpContext } from '@adonisjs/core/http'
import router from '@adonisjs/core/services/router'
import limiter from '@adonisjs/limiter/services/main'
import type { NextFn } from '@adonisjs/core/types/http'
import { controllers } from '#generated/controllers'
import { reject as rejectTaken } from '#middleware/rejections/taken'
import { reject as rejectUnverified } from '#middleware/rejections/unverified'

class Guard {
  async check(this: void, { request, response }: HttpContext, next: NextFn) {
    if (request.input('unpaid')) return response.paymentRequired({ code: 'E_UNPAID' as const })

    return next()
  }
}

const guard = new Guard()

class Quota {
  limit = 3

  enforce({ request, response }: HttpContext, next: NextFn) {
    if (request.input('count') > this.limit)
      return response.tooManyRequests({ code: 'E_QUOTA' as const })

    return next()
  }
}

const quota = new Quota()

const packaged = limiter.define('packaged', () => limiter.allowRequests(1).every('1 minute'))

router
  .group(() => {
    router
      .get('above', [controllers.Probe, 'text'])
      .as('above')
      .use(async ({ request, response }, next) => {
        if (request.input('n') > 0) return response.forbidden({ code: 'E_OUT_OF_RANGE' as const })

        return next()
      })
    router
      .get('below', [controllers.Probe, 'text'])
      .as('below')
      .use(async ({ request, response }, next) => {
        if (request.input('n') < 0) return response.forbidden({ code: 'E_OUT_OF_RANGE' as const })

        return next()
      })
    router
      .get('allowed', [controllers.Probe, 'text'])
      .as('allowed')
      .use(async ({ request, response }, next) => {
        if (request.input('n')) return response.forbidden({ allowed: true as const })

        return next()
      })
    router
      .get('denied', [controllers.Probe, 'text'])
      .as('denied')
      .use(async ({ request, response }, next) => {
        if (request.input('n')) return response.forbidden({ allowed: false as const })

        return next()
      })
    router.get('taken', [controllers.Probe, 'text']).as('taken').use(rejectTaken)
    router.get('unverified', [controllers.Probe, 'text']).as('unverified').use(rejectUnverified)
    router.get('method', [controllers.Probe, 'text']).as('method').use(guard.check)
    router.get('bound', [controllers.Probe, 'text']).as('bound').use(quota.enforce.bind(quota))
    router.get('packaged', [controllers.Probe, 'text']).as('packaged').use(packaged)
  })
  .prefix('inline')
  .as('inline')
