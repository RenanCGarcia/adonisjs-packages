import { createPostValidator } from '#validators/post'
import type { HttpContext } from '@adonisjs/core/http'

/**
 * @tags Forms
 */
export default class PostsController {
  /**
   * Create a post from a form
   *
   * The form sends its CSRF token in the `_csrf` field or the `X-CSRF-TOKEN` header. The
   * validation messages are in the locale of `Accept-Language`.
   */
  async store({ request, session, response }: HttpContext) {
    const { title } = await request.validateUsing(createPostValidator)
    session.flash('success', `Created ${title}`)

    return response.redirect('/')
  }
}
