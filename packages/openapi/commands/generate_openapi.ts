import { dirname, isAbsolute, relative, resolve } from 'node:path'
import { mkdir, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { flags } from '@adonisjs/core/ace'
import type { ResponseSource } from '../src/types.ts'
import { OpenApiCommand } from './base_command.ts'

function describe(source: ResponseSource) {
  const where = source.location ? ` (${source.location.file}:${source.location.line})` : ''

  switch (source.kind) {
    case 'return':
      return `the handler's return type${where}`
    case 'answer':
      return `a response call in the handler${where}`
    case 'throw':
      return `throw new ${source.exception}()${where}`
    case 'middleware':
      return `the middleware ${source.middleware}${where}`
    case 'security':
      return `the ${source.middleware} middleware secures the route`
    case 'validator':
      return 'the validator rejects the input'
    case 'tag':
      return `a ${source.tag} tag${where}`
  }
}

export default class GenerateOpenApi extends OpenApiCommand {
  static commandName = 'openapi:generate'
  static description = 'Generate an OpenAPI document from the routes, validators and transformers'

  @flags.string({
    description:
      'Output file, absolute or relative to the app root. Defaults to config/openapi.ts "output"',
  })
  declare output?: string

  @flags.string({
    description:
      'Print where each response of the named route comes from, without writing the file',
  })
  declare explain?: string

  #explain(route: string, provenance: Record<string, Record<string, ResponseSource[]>>) {
    const responses = provenance[route]

    if (!responses) {
      this.logger.error(`No documented route is named ${route}`)
      this.exitCode = 1

      return
    }

    for (const [code, sources] of Object.entries(responses)) {
      this.logger.log(code)

      for (const source of sources) this.logger.log(`  ${describe(source)}`)
    }
  }

  async run() {
    const startTime = process.hrtime()
    const { document, provenance, config } = await this.generate()

    if (this.explain) return this.#explain(this.explain, provenance)

    const appRoot = fileURLToPath(this.app.appRoot)
    const output = resolve(appRoot, this.output ?? config.output)
    await mkdir(dirname(output), { recursive: true })
    await writeFile(output, `${JSON.stringify(document, null, 2)}\n`)

    const shown = relative(appRoot, output)
    const inside = !shown.startsWith('..') && !isAbsolute(shown)

    this.logger.success(`OpenAPI document written to ${inside ? shown : output}`, {
      startTime,
    })
  }
}
