import { dirname, join } from 'node:path'
import { mkdir, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { BaseCommand, flags } from '@adonisjs/core/ace'
import { defineConfig } from '../src/define_config.ts'
import type { OpenApiConfig } from '../src/types.ts'

export default class GenerateOpenApi extends BaseCommand {
  static commandName = 'openapi:generate'
  static description = 'Generate an OpenAPI document from the routes, validators and transformers'

  @flags.string({
    description: 'Output file, relative to the app root. Defaults to config/openapi.ts "output"',
  })
  declare output?: string

  /**
   * Same warm-up as `node ace codegen`: the app is assembled like the web
   * environment, but never becomes ready, so no long-running side effect starts.
   */
  async #warmUpApp() {
    this.app.setEnvironment('web')
    this.app.setMode('warmup')
    await this.app.boot()
    await this.app.warmUp()

    const router = await this.app.container.make('router')
    router.commit()

    return router
  }

  async run() {
    const router = await this.#warmUpApp()
    const config = this.app.config.get<OpenApiConfig | undefined>('openapi') ?? defineConfig()
    const startTime = process.hrtime()

    // Loaded on run: it pulls in the TypeScript compiler, which every other ace command would pay for.
    const { generateDocument } = await import('../src/generate.ts')
    const { document, warnings } = await generateDocument(this.app, router, config)

    for (const warning of warnings) this.logger.warning(warning)

    const output = join(fileURLToPath(this.app.appRoot), this.output ?? config.output)
    await mkdir(dirname(output), { recursive: true })
    await writeFile(output, `${JSON.stringify(document, null, 2)}\n`)

    this.logger.success(`OpenAPI document written to ${this.app.relativePath(output)}`, {
      startTime,
    })
  }
}
