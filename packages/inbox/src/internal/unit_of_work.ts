import type { Database } from '@adonisjs/lucid/database'
import type { TransactionClientContract } from '@adonisjs/lucid/types/database'
import type { LucidModel, LucidRow, ModelObject } from '@adonisjs/lucid/types/model'

import { InboxError } from '../errors.ts'

/**
 * Thrown inside a unit of work to roll it back when a row it relied on moved. The caller reads
 * again and plans again.
 */
export class Conflict extends Error {}

/**
 * Runs `work` in one transaction and the effects it defers, such as emits, after the commit.
 * A savepoint's own `after('commit')` hooks would fire at the savepoint, before the outer commit.
 */
export async function unitOfWork<T>(
  db: Database,
  work: (
    trx: TransactionClientContract,
    later: (effect: () => Promise<void>) => void,
  ) => Promise<T>,
) {
  const effects: Array<() => Promise<void>> = []
  const result = await db.transaction(trx => work(trx, effect => effects.push(effect)))

  for (const effect of effects) await effect()

  return result
}

/**
 * A concurrent identical insert loses to a unique index, and then the winner is the answer.
 */
export async function findOrCreate<Row>(
  find: () => Promise<Row | null>,
  create: () => Promise<Row>,
) {
  const existing = await find()

  if (existing !== null) return existing

  try {
    return await create()
  } catch (error) {
    const winner = await find()

    if (winner !== null) return winner

    throw error
  }
}

/**
 * Attribute values as the columns the model writes, through each column's `prepare`, for writes
 * that have to go through a query builder to carry a `WHERE`.
 */
export function columnsOf(model: LucidModel, row: LucidRow, attributes: ModelObject) {
  const columns: ModelObject = {}

  for (const [attribute, value] of Object.entries(attributes)) {
    const column = model.$getColumn(attribute)

    if (column === undefined) {
      throw new InboxError(
        'E_INBOX_INVALID_CONFIG',
        `inbox: ${model.name} has no ${attribute} column. Did the inbox migration run?`,
      )
    }

    columns[column.columnName] = column.prepare ? column.prepare(value, attribute, row) : value
  }

  return columns
}

/**
 * A model query builder answers a write with `[affectedRows]` on every dialect.
 */
export function affectedRows(result: number[]) {
  return result[0] ?? 0
}
