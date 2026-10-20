import type { LucidModel } from '@adonisjs/lucid/types/model'
import type { DateTime } from 'luxon'

/**
 * A model query builder answers a write with `[affectedRows]` on every dialect.
 */
export function affectedRows(result: number[]) {
  return result[0] ?? 0
}

/**
 * A time as the dialect stores it. A query builder binds a `DateTime` in a `WHERE` or an
 * `update` as it is, without the column's `prepare`.
 */
export function sqlTime(model: LucidModel, time: DateTime) {
  return time.toFormat(model.query().client.dialect.dateTimeFormat)
}

/**
 * Thrown inside a transaction to roll it back when a row it relied on moved. The caller reads
 * again.
 */
export class Conflict extends Error {}
