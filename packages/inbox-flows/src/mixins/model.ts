import type { NormalizeConstructor } from '@adonisjs/core/types/helpers'
import type { BaseModel } from '@adonisjs/lucid/orm'
import type { LucidRow } from '@adonisjs/lucid/types/model'

import type { FlowsModelRole } from '../models.ts'

export type Model = NormalizeConstructor<typeof BaseModel>

/**
 * `M`'s statics, tagged with the role, with the instance columns in `Row` retyped, as the inbox's
 * models are. A JSON text column is a `string` in `database/schema.ts` and an object here.
 */
export type FlowsModel<R extends FlowsModelRole, Row, M extends Model = Model> = Omit<
  M,
  'prototype'
> & {
  readonly inboxFlowsRole: R
  new (...args: any[]): Omit<InstanceType<M>, keyof Row> & LucidRow & Row
}

/**
 * JSON is stored as TEXT on every dialect, so reads always parse a string.
 */
export function jsonText<T>() {
  return {
    prepare: (value: T) => JSON.stringify(value),
    consume: (value: string): T => JSON.parse(value),
  }
}

export function nullableJsonText<T>() {
  return {
    prepare: (value: T | null) => (value === null ? null : JSON.stringify(value)),
    consume: (value: string | null): T | null => (value === null ? null : JSON.parse(value)),
  }
}
