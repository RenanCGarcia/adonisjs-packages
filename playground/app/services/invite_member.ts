import { AuthorizationResponse, errors } from '@adonisjs/bouncer'

export default class InviteMember {
  async handle(email: string) {
    if (email.endsWith('@guest.test'))
      throw new errors.E_AUTHORIZATION_FAILURE(AuthorizationResponse.deny())
    return { invited: email }
  }
}
