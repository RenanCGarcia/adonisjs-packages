import type { ApplicationService } from '@adonisjs/core/types'
import { unreadableValidator } from '../diagnostics/route.ts'
import type { Diagnostic, JsonSchema } from '../types.ts'
import type { RouteOperation } from '../routes/route_operation.ts'

// The keys `request.validateUsing()` adds next to the body and the query string.
const NOT_IN_BODY = new Set(['params', 'headers', 'cookies'])

/**
 * Vine emits draft-7 object schemas, and every keyword JsonSchema names means the same there.
 */
interface VineValidator {
  toJSONSchema(): JsonSchema
}

/**
 * Vine knows the constraints (formats, bounds, enums) but has no JSON Schema for
 * files or custom rules and emits `{}` there: the TypeScript shape fills those gaps.
 */
export function mergeSchemas(vine: JsonSchema | undefined, typed: JsonSchema): JsonSchema {
  if (!vine || !Object.keys(vine).length) return typed

  if (!vine.properties || !typed.properties) return vine

  const typedProperties = typed.properties

  const properties = Object.fromEntries(
    Object.entries(vine.properties).map(([key, schema]) => [
      key,
      mergeSchemas(schema, typedProperties[key] ?? {}),
    ]),
  )

  // Vine leaves a `.nullable()` field out of `required`, although it rejects a body without the key.
  const required = Object.keys(properties).filter(
    key => vine.required?.includes(key) || typed.required?.includes(key),
  )

  return { ...vine, properties, ...(required.length > 0 && { required }) }
}

/**
 * The part of the input that is the request body: what `params`, `headers` and `cookies` hold is not.
 */
export function bodyFields(input: JsonSchema): JsonSchema | undefined {
  const keep = (key: string) => !NOT_IN_BODY.has(key)
  const properties = Object.entries(input.properties ?? {}).filter(([key]) => keep(key))

  if (!properties.length) return undefined

  const { required = [], ...rest } = input
  const kept = required.filter(keep)

  return kept.length
    ? { ...rest, properties: Object.fromEntries(properties), required: kept }
    : { ...rest, properties: Object.fromEntries(properties) }
}

export async function validatorSchemas(
  app: ApplicationService,
  routes: RouteOperation[],
  diagnostics: Diagnostic[],
) {
  const schemas = new Map<string, JsonSchema>()

  for (const route of routes) {
    if (!route.validator) continue

    const { specifier, exportName } = route.validator

    try {
      // SAFETY: the routes scanner only reports values passed to `request.validateUsing()`, which are Vine validators.
      const module = (await app.import(specifier)) as Record<string, VineValidator>
      const validator = module[exportName]

      if (validator) schemas.set(route.name, validator.toJSONSchema())
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error)
      diagnostics.push(unreadableValidator(route.name, specifier, exportName, reason))
    }
  }

  return schemas
}
