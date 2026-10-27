import { Exception } from '@adonisjs/core/exceptions'

export default class SeatLimitException extends Exception {
  static override status = 402
  static override code = 'E_SEAT_LIMIT'
}
