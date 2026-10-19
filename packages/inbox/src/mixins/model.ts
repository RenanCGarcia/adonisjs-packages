import type { NormalizeConstructor } from '@adonisjs/core/types/helpers'
import type { BaseModel } from '@adonisjs/lucid/orm'
import type { LucidRow } from '@adonisjs/lucid/types/model'

import type { ModelRole } from '../models.ts'

export type Model = NormalizeConstructor<typeof BaseModel>

/**
 * `M`'s statics, tagged with the role, with the instance columns in `Row` retyped. The retyped
 * columns replace the generated ones instead of intersecting with them, because a JSON text
 * column is a `string` in `database/schema.ts` and an object here.
 */
export type InboxModel<R extends ModelRole, Row, M extends Model = Model> = Omit<M, 'prototype'> & {
  readonly inboxRole: R
  new (...args: any[]): Omit<InstanceType<M>, keyof Row> & LucidRow & Row
}

/**
 * JSON is stored as TEXT on every dialect, so reads always parse a string. A `json` column
 * would come back parsed on pg and as a string on sqlite.
 */
export function jsonText<T>() {
  return {
    prepare: (value: T) => JSON.stringify(value),
    consume: (value: string): T => JSON.parse(value),
  }
}
