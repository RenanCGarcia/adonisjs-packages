import type { HttpContext } from '@adonisjs/core/http'
import logger from '@adonisjs/core/services/logger'

/**
 * The event the mail provider posts, in its own format.
 */
interface MailEvent {
  type: 'delivered' | 'bounced'
  messageId: string
  occurredAt: string
}

/**
 * @tags Webhooks
 */
export default class MailEventsController {
  /**
   * Receive a mail provider event
   *
   * @requestBody {MailEvent}
   */
  async store({ request, response }: HttpContext) {
    const event = request.body() as MailEvent
    logger.info({ event }, 'mail event')

    return response.noContent()
  }
}
