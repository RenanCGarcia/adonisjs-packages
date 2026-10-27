import ts from 'typescript'
import type { Json, JsonSchema } from '../types.ts'

const OMITTED = ts.TypeFlags.Undefined | ts.TypeFlags.Void

// `vine.file()` infers `MultipartFile` on the server and `File | Blob` for clients.
const BINARY = new Set(['MultipartFile', 'File', 'Blob'])

// `JSON.stringify` writes them as `{}`.
const EMPTY_OBJECTS = new Set(['Map', 'Set', 'ReadonlyMap', 'ReadonlySet', 'WeakMap', 'WeakSet'])

function jsonOrText(text: string): Json {
  try {
    // SAFETY: JSON.parse only returns JSON values.
    return JSON.parse(text) as Json
  } catch {
    return text
  }
}

/**
 * Converts a type the checker resolved into JSON Schema (draft 2020-12, as OpenAPI 3.1 uses).
 * Serialized output types are plain data, so methods are dropped and dates become strings.
 */
export class TypeToSchema {
  #checker: ts.TypeChecker
  #recursive = new Map<ts.Type, string>()
  #named: Map<ts.Type, string>
  #namesBySchema = new Map<string, string>()
  readonly components: Record<string, JsonSchema> = {}
  readonly unsupported = new Set<string>()
  readonly models = new Set<string>()

  /**
   * Every named type becomes a component up front: a transformer nested in another
   * resolves to a different type than its `Data` alias, and is matched by its schema
   * without the doc comments, which only `documented` gives.
   */
  constructor(
    checker: ts.TypeChecker,
    named = new Map<ts.Type, string>(),
    documented = new Map<ts.Type, ts.Type>(),
  ) {
    this.#checker = checker
    this.#named = named

    for (const [type, name] of named) {
      const serialized = JSON.stringify(this.#properties(type, []))
      this.components[name] = this.#properties(type, [], documented.get(type))

      if (!this.#namesBySchema.has(serialized)) this.#namesBySchema.set(serialized, name)
    }
  }

  convert(type: ts.Type, stack: ts.Type[] = []): JsonSchema {
    const flags = type.flags

    if (flags & (ts.TypeFlags.Any | ts.TypeFlags.Unknown)) return {}

    if (flags & ts.TypeFlags.Never) return { not: {} }

    if (type.isStringLiteral()) return { type: 'string', const: type.value }

    if (type.isNumberLiteral()) return { type: 'number', const: type.value }

    if (flags & ts.TypeFlags.BooleanLiteral)
      return { type: 'boolean', const: this.#checker.typeToString(type) === 'true' }

    if (flags & (ts.TypeFlags.String | ts.TypeFlags.TemplateLiteral)) return { type: 'string' }

    if (flags & ts.TypeFlags.Number) return { type: 'number' }

    // AdonisJS serializes a bigint as its digits in a string.
    if (flags & ts.TypeFlags.BigIntLike) return { type: 'string' }

    if (flags & ts.TypeFlags.Boolean) return { type: 'boolean' }

    if (flags & ts.TypeFlags.Null) return { type: 'null' }

    if (flags & OMITTED) return { not: {} }

    if (type.isUnion()) return this.#union(type, stack)

    const name = (type.aliasSymbol ?? type.getSymbol())?.getName()

    if (name === 'Date' || name === 'DateTime') return { type: 'string', format: 'date-time' }

    if (name && BINARY.has(name)) return { type: 'string', format: 'binary' }

    if (name && EMPTY_OBJECTS.has(name))
      return { type: 'object', properties: {}, additionalProperties: false }

    // A Lucid model serializes through `serialize()`, which its type does not describe.
    if (this.#checker.getPropertyOfType(type, '$attributes')) {
      this.models.add(this.#checker.typeToString(type))

      return {}
    }

    if (this.#checker.isArrayType(type)) {
      // SAFETY: isArrayType only holds for TypeReference instances.
      const [item] = this.#checker.getTypeArguments(type as ts.TypeReference)

      return { type: 'array', items: item ? this.convert(item, stack) : {} }
    }

    if (this.#checker.isTupleType(type)) {
      // SAFETY: isTupleType only holds for TypeReference instances.
      const items = this.#checker
        .getTypeArguments(type as ts.TypeReference)
        .map(item => this.convert(item, stack))

      return { type: 'array', prefixItems: items, minItems: items.length, maxItems: items.length }
    }

    if (flags & ts.TypeFlags.Object || type.isIntersection()) return this.#object(type, name, stack)

    this.unsupported.add(this.#checker.typeToString(type))

    return {}
  }

  /**
   * Whether `undefined` is one of the members, which makes an object property optional.
   */
  acceptsUndefined(type: ts.Type) {
    return type.isUnion()
      ? type.types.some(member => member.flags & OMITTED)
      : Boolean(type.flags & OMITTED)
  }

  #union(type: ts.UnionType, stack: ts.Type[]): JsonSchema {
    const members = type.types.filter(member => !(member.flags & OMITTED))
    const booleans = members.filter(member => member.flags & ts.TypeFlags.BooleanLiteral)

    const converted = members
      .filter(member => !(member.flags & ts.TypeFlags.BooleanLiteral))
      .map(member => this.convert(member, stack))

    if (booleans.length === 2) converted.push({ type: 'boolean' })
    else converted.push(...booleans.map(member => this.convert(member, stack)))

    const schemas = [...new Map(converted.map(schema => [JSON.stringify(schema), schema])).values()]

    if (schemas.length === 1) return schemas[0]!

    if (schemas.every(schema => 'const' in schema || schema.type === 'null')) {
      const types = [...new Set(schemas.flatMap(schema => schema.type ?? []))]

      return {
        type: types.length === 1 ? types[0] : types,
        enum: schemas.map(schema => schema.const ?? null),
      }
    }

    return { anyOf: schemas }
  }

  #object(type: ts.Type, name: string | undefined, stack: ts.Type[]): JsonSchema {
    const named = this.#named.get(type)

    if (named) return { $ref: `#/components/schemas/${named}` }

    if (stack.includes(type))
      return { $ref: `#/components/schemas/${this.#recursiveName(type, name)}` }

    const schema = this.#properties(type, stack)
    const ref = this.#recursive.get(type)

    if (ref) {
      this.components[ref] = schema

      return { $ref: `#/components/schemas/${ref}` }
    }

    const shared = this.#namesBySchema.get(JSON.stringify(schema))

    return shared ? { $ref: `#/components/schemas/${shared}` } : schema
  }

  #properties(type: ts.Type, stack: ts.Type[], documented?: ts.Type): JsonSchema {
    const next = [...stack, type]
    const properties: Record<string, JsonSchema> = {}
    const required: string[] = []

    for (const property of this.#checker.getPropertiesOfType(type)) {
      const propertyType = this.#checker.getTypeOfSymbol(property)

      // `__@` names a symbol key such as `Symbol.iterator`, which JSON leaves out like a property typed `undefined`.
      if (
        propertyType.getCallSignatures().length ||
        property.getName().startsWith('__@') ||
        propertyType.flags & OMITTED
      )
        continue

      properties[property.getName()] = {
        ...this.convert(propertyType, next),
        ...this.#documentation(documented?.getProperty(property.getName()) ?? property),
      }

      const optional =
        property.flags & ts.SymbolFlags.Optional || this.acceptsUndefined(propertyType)

      if (!optional) required.push(property.getName())
    }

    const [index] = this.#checker.getIndexInfosOfType(type)

    const schema: JsonSchema = {
      type: 'object',
      properties,
      additionalProperties: index ? this.convert(index.type, next) : false,
    }

    if (required.length) schema.required = required

    return schema
  }

  #documentation(property: ts.Symbol): JsonSchema {
    const schema: JsonSchema = {}
    const description = ts.displayPartsToString(property.getDocumentationComment(this.#checker))

    if (description.trim()) schema.description = description.trim()

    for (const tag of property.getJsDocTags(this.#checker)) {
      const text = ts.displayPartsToString(tag.text).trim()

      if (tag.name === 'deprecated') schema.deprecated = true
      else if (tag.name === 'example' && text) (schema.examples ??= []).push(jsonOrText(text))
      else if (tag.name === 'default' && text) schema.default = jsonOrText(text)
    }

    return schema
  }

  #recursiveName(type: ts.Type, name: string | undefined) {
    const existing = this.#recursive.get(type)

    if (existing) return existing

    const base = name && !name.startsWith('__') ? name : 'Recursive'
    const ref = this.components[base] ? `${base}${this.#recursive.size}` : base
    this.#recursive.set(type, ref)
    this.components[ref] = {}

    return ref
  }
}
