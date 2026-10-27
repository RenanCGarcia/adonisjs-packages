import { Exception } from '@adonisjs/core/exceptions'

/**
 * The plan is frozen
 */
export default class extends Exception {
  static override status = 423
}
