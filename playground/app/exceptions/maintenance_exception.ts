import { Exception } from '@adonisjs/core/exceptions'

export default class MaintenanceException extends Exception {
  static override status = 503
  static override code = 'E_MAINTENANCE'
}
