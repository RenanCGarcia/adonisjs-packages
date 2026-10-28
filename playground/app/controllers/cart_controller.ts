import type { HttpContext } from '@adonisjs/core/http'

/**
 * @tags Session
 */
export default class CartController {
  /**
   * Show the cart
   *
   * Returns the items kept in the session and the message the last request flashed.
   */
  async show({ session }: HttpContext) {
    return {
      items: session.get('cart', []) as string[],
      success: session.flashMessages.get('success') as string | undefined,
    }
  }

  /**
   * Add an item to the cart
   */
  async store({ request, session, response }: HttpContext) {
    session.put('cart', [...session.get('cart', []), String(request.input('item'))])
    session.flash('success', 'Item added to the cart')

    return response.redirect().back()
  }
}
