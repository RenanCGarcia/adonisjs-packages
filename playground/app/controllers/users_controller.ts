import User from '#models/user'
import UserTransformer from '#transformers/user_transformer'
import { listUsersValidator, showUserValidator } from '#validators/user_lookup'
import type { HttpContext } from '@adonisjs/core/http'

export default class UsersController {
  async index({ request, serialize }: HttpContext) {
    const { page = 1, perPage = 20 } = await request.validateUsing(listUsersValidator)
    const users = await User.query().paginate(page, perPage)

    return serialize(UserTransformer.transform(users.all()))
  }

  async show({ request, serialize }: HttpContext) {
    const { params } = await request.validateUsing(showUserValidator)

    return serialize(UserTransformer.transform(await User.findOrFail(params.id)))
  }
}
