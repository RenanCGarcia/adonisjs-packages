import { Exception } from '@adonisjs/core/exceptions'

/**
 * The plan allows no more of it
 */
export default class LimitException extends Exception {
  static override status = 402
}
