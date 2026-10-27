import { BaseCommand } from '@adonisjs/core/ace'
import { defineConfig } from '../src/define_config.ts'
import type { Diagnostic, OpenApiConfig } from '../src/types.ts'

/**
 * Generates the document the way `node ace codegen` reads the app: assembled like the web
 * environment, but never ready, so no long-running side effect starts.
 */
export abstract class OpenApiCommand extends BaseCommand {
  protected async generate() {
    this.app.setEnvironment('web')
    this.app.setMode('warmup')
    await this.app.boot()
    await this.app.warmUp()

    const router = await this.app.container.make('router')
    router.commit()

    const config = this.app.config.get<OpenApiConfig | undefined>('openapi') ?? defineConfig()

    // Loaded on run: it pulls in the TypeScript compiler, which every other ace command would pay for.
    const { generateDocument } = await import('../src/generate.ts')
    const generated = await generateDocument(this.app, router, config)

    for (const diagnostic of generated.diagnostics) this.#report(diagnostic)

    return { ...generated, config }
  }

  #report({ code, severity, route, message, fix, location }: Diagnostic) {
    const where = location ? ` (${location.file}:${location.line})` : ''
    const text = `${code} ${route ? `${route}: ` : ''}${message}${fix ? `: ${fix}` : ''}${where}`

    if (severity === 'error') this.logger.error(text)
    else this.logger.warning(text)
  }
}
