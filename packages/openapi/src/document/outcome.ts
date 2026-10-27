import { STATUS_CODES } from 'node:http'
import type { JsonSchema, OpenApiResponse, ResponseSource } from '../types.ts'

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
}

export interface Contribution {
  bodies?: Body[]
  reason?: string
  headers?: Iterable<string>
}

const EMPTY_STATUSES = new Set(['204', '205', '304'])

/**
 * Bodies with the same schema, such as two exceptions rendered by the same handler, appear once.
 */
function render(code: string, { reasons, bodies, headers, optional }: Outcome): OpenApiResponse {
  const status = STATUS_CODES[Number(code)] ?? 'Response'
  const description = reasons.join('; ') || status

  const response: OpenApiResponse = {
    description: optional ? `${description}, or no body` : description,
  }

  if (headers.size)
    response.headers = Object.fromEntries(
      [...headers].map(name => [name, { schema: { type: 'string' } }]),
    )

  if (EMPTY_STATUSES.has(code) || !bodies.length) return response

  const content: NonNullable<OpenApiResponse['content']> = {}

  for (const mediaType of new Set(bodies.map(body => body.mediaType))) {
    const schemas = bodies.filter(body => body.mediaType === mediaType).map(body => body.schema)
    const unique = [...new Map(schemas.map(schema => [JSON.stringify(schema), schema])).values()]

    content[mediaType] = { schema: unique.length > 1 ? { oneOf: unique } : unique[0]! }
  }

  return { ...response, content }
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
      found = { reasons: [], bodies: [], headers: new Set(), optional: false, sources: [] }
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
    { bodies = [], reason, headers = [] }: Contribution = {},
  ) {
    const found = this.#outcome(code)
    found.sources.push(...[source].flat())
    found.bodies.push(...bodies)

    for (const header of headers) found.headers.add(header)

    if (reason && !found.reasons.includes(reason)) found.reasons.push(reason)
  }

  markOptional(code: string) {
    this.#outcome(code).optional = true
  }

  render() {
    const entries = [...this.#byCode]

    return {
      responses: Object.fromEntries(entries.map(([code, found]) => [code, render(code, found)])),
      sources: Object.fromEntries(entries.map(([code, found]) => [code, found.sources])),
    }
  }
}
