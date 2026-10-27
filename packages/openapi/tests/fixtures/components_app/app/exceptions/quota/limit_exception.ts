import { Exception } from '@adonisjs/core/exceptions'

/**
 * The upload is larger than the quota
 */
export default class LimitException extends Exception {
  static override status = 413
}
