import User from '#models/user'
import UserTransformer from '#transformers/user_transformer'
import { listUsersValidator, showUserValidator } from '#validators/user_lookup'
import type { HttpContext } from '@adonisjs/core/http'

/**
 * @tags Users
 */
export default class UsersController {
  /**
   * List users
   *
   * Returns one page of users, without the pagination metadata.
   *
   * @tags Directory
   * @deprecated Clients cannot tell when they reached the last page.
   */
  async index({ request, serialize }: HttpContext) {
    const { page = 1, perPage = 20 } = await request.validateUsing(listUsersValidator)
    const users = await User.query().paginate(page, perPage)

    return serialize(UserTransformer.transform(users.all()))
  }

  /**
   * Show a user
   *
   * Looks the user up by its numeric id.
   *
   * @throws {404} User not found
   */
  async show({ request, serialize }: HttpContext) {
    const { params } = await request.validateUsing(showUserValidator)

    return serialize(UserTransformer.transform(await User.findOrFail(params.id)))
  }
}
