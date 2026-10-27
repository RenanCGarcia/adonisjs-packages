import type { HttpContext } from '@adonisjs/core/http'
import type { NextFn } from '@adonisjs/core/types/http'
import Rejected from '#exceptions/email_taken_exception'

export const reject = async ({ request }: HttpContext, next: NextFn) => {
  if (request.input('email')) throw new Rejected(request.input('email'))

  return next()
}
