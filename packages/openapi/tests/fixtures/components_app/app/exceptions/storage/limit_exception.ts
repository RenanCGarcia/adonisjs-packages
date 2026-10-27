import { Exception } from '@adonisjs/core/exceptions'

/**
 * The storage is full
 */
export default class LimitException extends Exception {
  static override status = 402
}
