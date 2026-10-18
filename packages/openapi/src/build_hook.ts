import { spawn } from 'node:child_process'
import { once } from 'node:events'
import type { Bundler } from '@adonisjs/assembler'
import { hooks } from '@adonisjs/core/app'

/**
 * Runs before `node ace build` compiles the app and copies the meta files, so the
 * document lands in the build folder when its path is listed in `metaFiles`.
 */
const generateOnBuild: (bundler: Bundler) => void | PromiseLike<void> = hooks.buildStarting(
  async bundler => {
    bundler.ui.logger.info('generating the OpenAPI document', { suffix: 'openapi:generate' })

    const child = spawn(process.execPath, ['ace', 'openapi:generate'], {
      cwd: bundler.cwdPath,
      stdio: 'inherit',
    })

    const [code] = await once(child, 'close')

    if (code !== 0) throw new Error(`"node ace openapi:generate" exited with code ${code}`)
  },
)

export default generateOnBuild
