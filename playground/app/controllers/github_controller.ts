import type { HttpContext } from '@adonisjs/core/http'

/**
 * @tags OAuth
 */
export default class GithubController {
  /**
   * Redirect to GitHub
   */
  async redirect({ ally, session }: HttpContext) {
    session.put('redirect.previousUrl', '/login')

    return ally.use('github').redirect()
  }

  /**
   * Handle the GitHub callback
   */
  async callback({ ally }: HttpContext) {
    const githubUser = await ally.use('github').user()

    return { email: githubUser.email, name: githubUser.name }
  }
}
