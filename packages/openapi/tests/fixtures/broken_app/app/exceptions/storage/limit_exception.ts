import { Exception } from '@adonisjs/core/exceptions'

export default class LimitException extends Exception {
  static override status = 507
}
