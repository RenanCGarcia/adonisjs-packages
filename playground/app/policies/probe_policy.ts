import User from '#models/user'
import { AuthorizationResponse, BasePolicy, allowGuest } from '@adonisjs/bouncer'
import type { AuthorizerResponse } from '@adonisjs/bouncer/types'

export default class ProbePolicy extends BasePolicy {
  view(user: User): AuthorizerResponse {
    return user.email.endsWith('@example.com')
  }

  /**
   * Answers 404 so a guest cannot tell a hidden probe from a missing one.
   */
  @allowGuest()
  show(user: User | null): AuthorizerResponse {
    return user ? true : AuthorizationResponse.deny('Probe not found', 404)
  }
}
