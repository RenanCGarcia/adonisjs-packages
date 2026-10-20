import app from '@adonisjs/core/services/app'
import type { HttpContext } from '@adonisjs/core/http'

export default class InboxConsoleController {
  show({ response }: HttpContext) {
    return response.download(app.makePath('resources/console.html'))
  }
}
