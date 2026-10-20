export const VARIABLE_TYPES = ['text', 'number', 'boolean'] as const

export type VariableType = (typeof VARIABLE_TYPES)[number]

/**
 * Tagged by the declared type, so a condition compares numbers as numbers and nothing asks a
 * stored value what it holds.
 */
export type Value =
  | { type: 'text'; value: string }
  | { type: 'number'; value: number }
  | { type: 'boolean'; value: boolean }

export type ValueOf<Type extends VariableType> = Extract<Value, { type: Type }>

export type Variables = { readonly [name: string]: Value }

const TRUE_WORDS = new Set(['true', 'yes', 'y', '1'])
const FALSE_WORDS = new Set(['false', 'no', 'n', '0'])

/**
 * What a contact or an editor typed, read as a declared type. `null` when it doesn't read as one.
 */
export function parseValue(type: VariableType, raw: string): Value | null {
  const trimmed = raw.trim()

  switch (type) {
    case 'text':
      return { type, value: raw }
    case 'number': {
      const value = Number(trimmed)

      return trimmed === '' || !Number.isFinite(value) ? null : { type, value }
    }

    case 'boolean': {
      const word = trimmed.toLowerCase()

      if (TRUE_WORDS.has(word)) return { type, value: true }

      return FALSE_WORDS.has(word) ? { type, value: false } : null
    }
  }
}

export function formatValue(value: Value): string {
  return String(value.value)
}

const PLACEHOLDER = /\{\{\s*([a-z][a-z0-9_]{0,63})\s*\}\}/g

/**
 * `{{name}}` in one pass. An unset variable renders as ''.
 */
export function render(template: string, vars: Variables): string {
  return template.replace(PLACEHOLDER, (_match, name: string) => {
    const value = vars[name]

    return value ? formatValue(value) : ''
  })
}

export function templateReads(template: string): string[] {
  return [...template.matchAll(PLACEHOLDER)].map(match => match[1])
}

type OperatorSpec<T> =
  | { operand: false; test: (left: T) => boolean }
  | { operand: true; test: (left: T, right: T) => boolean }

const unary = <T>(test: (left: T) => boolean): OperatorSpec<T> => ({ operand: false, test })

const binary = <T>(test: (left: T, right: T) => boolean): OperatorSpec<T> => ({
  operand: true,
  test,
})

const fold = (text: string) => text.trim().toLowerCase()

/**
 * Text compares trimmed and case-insensitive, like omnichannel's flows.
 */
const TEXT = {
  equals: binary<string>((left, right) => fold(left) === fold(right)),
  not_equals: binary<string>((left, right) => fold(left) !== fold(right)),
  contains: binary<string>((left, right) => fold(left).includes(fold(right))),
  not_contains: binary<string>((left, right) => !fold(left).includes(fold(right))),
  starts_with: binary<string>((left, right) => fold(left).startsWith(fold(right))),
  is_empty: unary<string>(left => fold(left) === ''),
}

const NUMBER = {
  equals: binary<number>((left, right) => left === right),
  not_equals: binary<number>((left, right) => left !== right),
  gt: binary<number>((left, right) => left > right),
  gte: binary<number>((left, right) => left >= right),
  lt: binary<number>((left, right) => left < right),
  lte: binary<number>((left, right) => left <= right),
}

const BOOLEAN = {
  is_true: unary<boolean>(left => left),
  is_false: unary<boolean>(left => !left),
}

/**
 * Every type also has these. They are the only operators that hold on an unset variable.
 */
const PRESENCE = ['is_set', 'is_not_set'] as const

const TABLES = {
  text: new Map(Object.entries(TEXT)),
  number: new Map(Object.entries(NUMBER)),
  boolean: new Map(Object.entries(BOOLEAN)),
}

export type Operator =
  | keyof typeof TEXT
  | keyof typeof NUMBER
  | keyof typeof BOOLEAN
  | (typeof PRESENCE)[number]

export const OPERATORS = [
  ...new Set([...Object.keys(TEXT), ...Object.keys(NUMBER), ...Object.keys(BOOLEAN), ...PRESENCE]),
]

export interface OperatorEntry {
  id: string
  operand: boolean
}

/**
 * The operators a variable of this type offers, for the editor and the publish checks.
 */
export function operatorsFor(type: VariableType): OperatorEntry[] {
  return [
    ...[...TABLES[type]].map(([id, spec]) => ({ id, operand: spec.operand })),
    ...PRESENCE.map(id => ({ id, operand: false })),
  ]
}

function holds<T>(
  table: ReadonlyMap<string, OperatorSpec<T>>,
  left: T,
  operator: string,
  operand: T | null,
): boolean {
  const spec = table.get(operator)

  if (!spec) return false

  if (!spec.operand) return spec.test(left)

  return operand !== null && spec.test(left, operand)
}

/**
 * Shared by the `condition` node and activation conditions, so both mean the same thing. The
 * operand is parsed as the left side's type. An operator the type doesn't offer, or an operand
 * that doesn't parse, is false rather than an error, so a stale condition never breaks a run.
 */
export function compare(left: Value | null, operator: string, operand = ''): boolean {
  if (operator === 'is_set') return left !== null

  if (operator === 'is_not_set') return left === null

  if (left === null) return false

  const right = parseValue(left.type, operand)

  switch (left.type) {
    case 'text':
      return holds(TABLES.text, left.value, operator, operand)
    case 'number':
      return holds(
        TABLES.number,
        left.value,
        operator,
        right?.type === 'number' ? right.value : null,
      )
    case 'boolean':
      return holds(
        TABLES.boolean,
        left.value,
        operator,
        right?.type === 'boolean' ? right.value : null,
      )
  }
}
