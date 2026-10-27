import type User from '#models/user'
import { BaseTransformer } from '@adonisjs/core/transformers'

export default class MemberCardTransformer extends BaseTransformer<User> {
  toObject() {
    return {
      /**
       * The name shown on the card, or the email when the member has no name.
       *
       * @example "Jane Doe"
       */
      displayName: this.resource.fullName ?? this.resource.email,
      /**
       * @example "JD"
       */
      initials: this.resource.initials,
      /**
       * Read `displayName` instead.
       *
       * @deprecated
       */
      name: this.resource.fullName,
      /**
       * How many seats the member's plan holds.
       *
       * @default 1
       */
      seats: 1,
    }
  }
}
