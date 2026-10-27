import type Configure from '@adonisjs/core/commands/configure'
import { stubsRoot } from './stubs/main.ts'

export async function configure(command: Configure) {
  const codemods = await command.createCodemods()

  await codemods.makeUsingStub(stubsRoot, 'config/openapi.stub', {})
  await codemods.updateRcFile(rcFile => {
    rcFile.addCommand('@enzopita/adonisjs-openapi/commands')
    rcFile.addAssemblerHook('buildStarting', '@enzopita/adonisjs-openapi/build_hook')
  })

  command.ui
    .instructions()
    .heading('To serve the docs page, register its routes in start/routes.ts')
    .add(`import { openapiRoutes } from '@enzopita/adonisjs-openapi/routes'`)
    .add(`openapiRoutes()`)
    .render()
}
