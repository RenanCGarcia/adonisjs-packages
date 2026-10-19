import type { HttpContext } from '@adonisjs/core/http'
import inbox from '@enzopita/adonisjs-inbox/services/main'

export default class InboxWebhooksController {
  async store({ params, request, response }: HttpContext) {
    const receipt = await inbox.ingest(params.token, {
      headers: request.headers(),
      rawBody: request.raw() ?? '',
    })

    switch (receipt) {
      case 'accepted':
        return response.ok({})
      case 'unknown_channel':
        return response.notFound({})
      case 'invalid_signature':
        return response.unauthorized({})
    }
  }
}
