import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { isAbsolute, relative, sep } from 'node:path'
import type { Bundler } from '@adonisjs/assembler'
import { hooks } from '@adonisjs/core/app'
import { isOutputMessage } from './output_message.ts'

/**
 * Runs before `node ace build` compiles the app and copies the meta files, and adds the document
 * the config `output` names to them, so it lands in the build folder at the same path.
 */
const generateOnBuild: (bundler: Bundler) => void | PromiseLike<void> = hooks.buildStarting(
  async bundler => {
    bundler.ui.logger.info('generating the OpenAPI document', { suffix: 'openapi:generate' })

    // A warning must not fail a build: `strict` is for `openapi:check` and CI.
    const child = spawn(process.execPath, ['ace', 'openapi:generate', '--no-strict'], {
      cwd: bundler.cwdPath,
      stdio: ['inherit', 'inherit', 'inherit', 'ipc'],
    })

    let output: string | undefined

    child.on('message', message => {
      if (isOutputMessage(message)) output = message.path
    })

    const [code] = await once(child, 'close')

    if (code !== 0) throw new Error(`"node ace openapi:generate" exited with code ${code}`)

    if (!output) {
      bundler.ui.logger.warning(
        '"node ace openapi:generate" did not say where it wrote the OpenAPI document, which is not shipped',
      )

      return
    }

    // `metaFiles` are glob patterns, which take `/` on Windows too.
    const pattern = relative(bundler.cwdPath, output).split(sep).join('/')

    if (pattern.startsWith('..') || isAbsolute(pattern)) {
      bundler.ui.logger.warning(`the OpenAPI document at ${output} is outside the app, not shipped`)

      return
    }

    const metaFiles = (bundler.options.metaFiles ??= [])

    if (!metaFiles.some(file => file.pattern === pattern))
      metaFiles.push({ pattern, reloadServer: false })
  },
)

export default generateOnBuild
