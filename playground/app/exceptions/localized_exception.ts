import { Exception } from '@adonisjs/core/exceptions'

export default class LocalizedException<Code extends string = string> extends Exception {
  declare code: Code
}
