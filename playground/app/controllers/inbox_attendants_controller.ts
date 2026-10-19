import type { HttpContext } from '@adonisjs/core/http'
import inbox from '@enzopita/adonisjs-inbox/services/main'

export default class InboxAttendantsController {
  async deactivate({ params, response }: HttpContext) {
    await inbox.attendants.deactivate(await inbox.attendants.forUser(Number(params.userId)))

    return response.noContent()
  }
}
