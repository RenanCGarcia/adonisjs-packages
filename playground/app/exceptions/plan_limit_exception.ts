import { Exception } from '@adonisjs/core/exceptions'

export default class PlanLimitException extends Exception {
  static override status = 402
  static override code = 'E_PLAN_LIMIT'
}
