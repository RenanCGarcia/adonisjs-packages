import type { HttpContext } from '@adonisjs/core/http'
import type { NextFn } from '@adonisjs/core/types/http'

/**
 * The X-Tenant-Id header is missing
 */
export default class TenantMiddleware {
  async handle(ctx: HttpContext, next: NextFn) {
    if (!ctx.request.header('x-tenant-id')) {
      return ctx.response.badRequest({
        code: 'E_INVALID_TENANT_HEADER' as const,
        message: 'Missing X-Tenant-Id header',
      })
    }

    return next()
  }
}
