import { relative } from 'node:path'
import type { OpenApiReference, OpenApiResponse } from '../types.ts'
import type { ResponseOwner } from './response_owner.ts'
import { componentName } from './component_name.ts'

interface Shared {
  owner: ResponseOwner
  code: string
  response: OpenApiResponse
  serialized: string
  references: OpenApiReference[]
}

/**
 * The responses a middleware or an exception describes once in its doc comment, which every
 * operation it answers for references from `components.responses`.
 */
export class ResponseComponents {
  #appRoot: string
  #shared: Shared[] = []

  constructor(appRoot: string) {
    this.#appRoot = appRoot
  }

  /**
   * The reference is named once every operation is read, so a name does not depend on the order
   * of the routes.
   */
  ref(owner: ResponseOwner, code: string, response: OpenApiResponse): OpenApiReference {
    const serialized = JSON.stringify(response)
    const reference = { $ref: '' }

    const found = this.#shared.find(
      shared =>
        shared.owner.symbol === owner.symbol &&
        shared.code === code &&
        shared.serialized === serialized,
    )

    if (found) found.references.push(reference)
    else this.#shared.push({ owner, code, response, serialized, references: [reference] })

    return reference
  }

  /**
   * `app/exceptions/billing/limit_exception.ts` gives `app.exceptions.billing.limit_exception`.
   */
  #module(owner: ResponseOwner) {
    return componentName(relative(this.#appRoot, owner.file).replace(/\.[^./\\]+$/, ''))
  }

  /**
   * Named after the owner class. Responses that would share a name are named after their status
   * code too, then after the module of their class, then numbered in the order of their content.
   */
  #name(group: Shared[], name: string, named: Map<Shared, string>) {
    const contents = [...new Set(group.map(shared => shared.serialized))].sort()

    if (contents.length === 1) {
      for (const shared of group) named.set(shared, name)

      return
    }

    const byCode = Map.groupBy(group, shared => shared.code)
    const modules = new Set(group.map(shared => this.#module(shared.owner)))

    if (byCode.size > 1)
      for (const [code, same] of byCode) this.#name(same, `${name}_${code}`, named)
    else if (modules.size > 1)
      for (const same of Map.groupBy(group, shared => this.#module(shared.owner)).values())
        this.#name(same, `${this.#module(same[0]!.owner)}.${name}`, named)
    else
      for (const shared of group)
        named.set(shared, `${name}_${contents.indexOf(shared.serialized) + 1}`)
  }

  /**
   * Names every shared response, completing the references `ref()` returned, by name.
   */
  responses(): Record<string, OpenApiResponse> {
    const named = new Map<Shared, string>()

    for (const [name, group] of Map.groupBy(this.#shared, shared => shared.owner.name))
      this.#name(group, name, named)

    for (const [shared, name] of named)
      for (const reference of shared.references) reference.$ref = `#/components/responses/${name}`

    const byName = new Map([...named].map(([shared, name]) => [name, shared.response]))

    return Object.fromEntries([...byName.keys()].sort().map(name => [name, byName.get(name)!]))
  }
}
