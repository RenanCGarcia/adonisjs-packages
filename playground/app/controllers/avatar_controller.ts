import { updateAvatarValidator } from '#validators/avatar'
import type { HttpContext } from '@adonisjs/core/http'

/**
 * @tags Account
 */
export default class AvatarController {
  async update({ request }: HttpContext) {
    const { avatar } = await request.validateUsing(updateAvatarValidator)

    return { name: avatar.clientName, size: avatar.size }
  }

  async destroy({ response }: HttpContext) {
    return response.noContent()
  }
}
