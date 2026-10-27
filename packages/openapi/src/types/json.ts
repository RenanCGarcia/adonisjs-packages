export type JsonValue = string | number | boolean | null

/**
 * The JSON Schema keywords the generator reads or writes. Keywords Vine adds
 * (`minLength`, `pattern`...) pass through untouched.
 */
export interface JsonSchema {
  $ref?: string
  type?: string | string[]
  format?: string
  const?: JsonValue
  enum?: JsonValue[]
  properties?: Record<string, JsonSchema>
  required?: string[]
  additionalProperties?: boolean | JsonSchema
  items?: JsonSchema
  prefixItems?: JsonSchema[]
  minItems?: number
  maxItems?: number
  anyOf?: JsonSchema[]
  oneOf?: JsonSchema[]
  not?: JsonSchema
}

export type Json = JsonValue | Json[] | { [key: string]: Json }
