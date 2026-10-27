import { Exception } from '@adonisjs/core/exceptions'

export default class LedgerException extends Exception {
  static override status = 409

  constructor(message?: string) {
    super(message)
    console.log('LedgerException constructed')
  }
}
