import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Json } from '../src/types.ts'
import { OpenApiCommand } from './base_command.ts'

const SHOWN = 20

function children(value: Json | undefined) {
  if (Array.isArray(value)) return new Map(value.map((item, index) => [String(index), item]))

  if (value instanceof Object) return new Map(Object.entries(value))

  return undefined
}

/**
 * The JSON Pointers where `committed` and `generated` differ, stopping at the first differing
 * value of each branch.
 */
function differences(
  committed: Json | undefined,
  generated: Json | undefined,
  pointer = '',
): string[] {
  const left = children(committed)
  const right = children(generated)

  if (!left || !right)
    return JSON.stringify(committed) === JSON.stringify(generated) ? [] : [pointer || '/']

  return [...new Set([...left.keys(), ...right.keys()])].flatMap(key =>
    differences(
      left.get(key),
      right.get(key),
      `${pointer}/${key.replaceAll('~', '~0').replaceAll('/', '~1')}`,
    ),
  )
}

/**
 * How the committed document compares with the one the app generates.
 */
type Comparison =
  | { kind: 'missing' }
  | { kind: 'current' }
  | { kind: 'unreadable' }
  | { kind: 'formatting' }
  | { kind: 'differs'; pointers: string[] }

export default class CheckOpenApi extends OpenApiCommand {
  static commandName = 'openapi:check'
  static description =
    'Fail on diagnostics, or when the committed OpenAPI document differs from the one the app generates. Writes no file'

  async #compare(output: string, generated: string): Promise<Comparison> {
    let committed: string

    try {
      committed = await readFile(output, 'utf8')
    } catch {
      return { kind: 'missing' }
    }

    if (committed === generated) return { kind: 'current' }

    let before: Json

    try {
      before = JSON.parse(committed)
    } catch {
      return { kind: 'unreadable' }
    }

    const pointers = differences(before, JSON.parse(generated))

    // Same content in another formatting, such as a file a formatter rewrote.
    return pointers.length ? { kind: 'differs', pointers } : { kind: 'formatting' }
  }

  async run() {
    const { document, config, failed } = await this.generate()
    const output = resolve(fileURLToPath(this.app.appRoot), config.output)
    const comparison = await this.#compare(output, `${JSON.stringify(document, null, 2)}\n`)
    const regenerate = 'run node ace openapi:generate'

    if (failed) this.logger.error('The errors above fail the check')

    switch (comparison.kind) {
      case 'current':
        if (!failed) this.logger.success(`${config.output} is up to date`)

        return
      case 'missing':
        this.logger.error(`${config.output} does not exist: ${regenerate}`)
        break
      case 'unreadable':
        this.logger.error(`${config.output} is not valid JSON: ${regenerate}`)
        break
      case 'formatting':
        this.logger.error(`${config.output} differs in its formatting only: ${regenerate}`)
        break
      case 'differs': {
        const { pointers } = comparison

        this.logger.error(`${config.output} is out of date: ${regenerate}. It differs at:`)

        for (const pointer of pointers.slice(0, SHOWN)) this.logger.log(`  ${pointer}`)

        if (pointers.length > SHOWN) this.logger.log(`  and ${pointers.length - SHOWN} more`)
      }
    }

    this.exitCode = 1
  }
}
