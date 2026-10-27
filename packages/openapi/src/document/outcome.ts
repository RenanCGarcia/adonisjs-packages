import { STATUS_CODES } from 'node:http'
import type ts from 'typescript'
import type { JsonSchema, OpenApiReference, OpenApiResponse, ResponseSource } from '../types.ts'
import type { ResponseComponents } from './response_components.ts'
import { responseOwner, type ResponseOwner } from './response_owner.ts'

export interface Body {
  mediaType: string
  schema: JsonSchema
}

/**
 * Everything an operation can answer with under one status code.
 */
interface Outcome {
  /**
   * The descriptions `@throws` and `@response` tags give, joined into the response description.
   */
  reasons: string[]
  bodies: Body[]
  headers: Set<string>
  /**
   * Whether the handler can also answer with no body, as when it returns `T | undefined`.
   */
  optional: boolean
  sources: ResponseSource[]
  /**
   * The class each contribution comes from, if any.
   */
  owners: (ts.Symbol | undefined)[]
}

export interface Contribution {
  bodies?: Body[]
  reason?: string
  headers?: Iterable<string>
  owner?: ts.Symbol
}

const EMPTY_STATUSES = new Set(['204', '205', '304'])

/**
 * The reasons the tags of the operation give replace the others. Else each contribution is
 * described by the class it comes from, and the status text stands for the ones without a reason.
 */
function describe(code: string, reasons: string[], owners: (ResponseOwner | undefined)[]) {
  const status = STATUS_CODES[Number(code)] ?? 'Response'

  if (reasons.length) return reasons.join('; ')

  const described = owners.flatMap(owner => owner?.reason ?? [])
  const unexplained = described.length < owners.length ? [status] : []

  return [...new Set([...described, ...unexplained])].join('; ')
}

/**
 * The class every contribution comes from, when it describes the response, which makes the
 * response shared.
 */
function sharedOwner(reasons: string[], owners: (ResponseOwner | undefined)[]) {
  const [first] = owners

  return !reasons.length && first?.reason && owners.every(owner => owner?.symbol === first.symbol)
    ? first
    : undefined
}

/**
 * Bodies with the same schema, such as two exceptions rendered by the same handler, appear once.
 * A response its owner class describes is shared through `components.responses`.
 */
function render(
  code: string,
  outcome: Outcome,
  components: ResponseComponents,
): OpenApiResponse | OpenApiReference {
  const { reasons, bodies, headers, optional } = outcome
  const owners = outcome.owners.map(responseOwner)
  const description = describe(code, reasons, owners)

  const response: OpenApiResponse = {
    description: optional ? `${description}, or no body` : description,
  }

  if (headers.size)
    response.headers = Object.fromEntries(
      [...headers].map(name => [name, { schema: { type: 'string' } }]),
    )

  if (!EMPTY_STATUSES.has(code) && bodies.length) {
    const content: NonNullable<OpenApiResponse['content']> = {}

    for (const mediaType of new Set(bodies.map(body => body.mediaType))) {
      const schemas = bodies.filter(body => body.mediaType === mediaType).map(body => body.schema)
      const unique = [...new Map(schemas.map(schema => [JSON.stringify(schema), schema])).values()]

      content[mediaType] = { schema: unique.length > 1 ? { oneOf: unique } : unique[0]! }
    }

    response.content = content
  }

  const shared = sharedOwner(reasons, owners)

  return shared ? components.ref(shared, code, response) : response
}

/**
 * The responses of an operation by status code, in the order they were first documented. Every
 * source (the return type, the handler's own response calls, the exceptions it throws, the
 * validator, the middleware) adds to it, so branches that share a status code all end up in its body.
 */
export class Outcomes {
  #byCode = new Map<string, Outcome>()

  #outcome(code: string) {
    let found = this.#byCode.get(code)

    if (!found) {
      found = {
        reasons: [],
        bodies: [],
        headers: new Set(),
        optional: false,
        sources: [],
        owners: [],
      }
      this.#byCode.set(code, found)
    }

    return found
  }

  get size() {
    return this.#byCode.size
  }

  has(code: string) {
    return this.#byCode.has(code)
  }

  add(
    code: string,
    source: ResponseSource | ResponseSource[],
    { bodies = [], reason, headers = [], owner }: Contribution = {},
  ) {
    const found = this.#outcome(code)
    found.sources.push(...[source].flat())
    found.bodies.push(...bodies)
    found.owners.push(owner)

    for (const header of headers) found.headers.add(header)

    if (reason && !found.reasons.includes(reason)) found.reasons.push(reason)
  }

  markOptional(code: string) {
    this.#outcome(code).optional = true
  }

  render(components: ResponseComponents) {
    const entries = [...this.#byCode]

    return {
      responses: Object.fromEntries(
        entries.map(([code, found]) => [code, render(code, found, components)]),
      ),
      sources: Object.fromEntries(entries.map(([code, found]) => [code, found.sources])),
    }
  }
}
