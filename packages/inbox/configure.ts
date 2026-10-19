import type Configure from '@adonisjs/core/commands/configure'

import { MODEL_ROLES } from './src/models.ts'
import { stubsRoot } from './stubs/main.ts'

export function modelStubOf(role: (typeof MODEL_ROLES)[number]) {
  return `models/${role.replace(/[A-Z]/g, letter => `_${letter.toLowerCase()}`)}.stub`
}

export async function configure(command: Configure) {
  const codemods = await command.createCodemods()

  await codemods.updateRcFile(rcFile => {
    rcFile.addProvider('@enzopita/adonisjs-inbox/inbox_provider')
  })

  await codemods.makeUsingStub(stubsRoot, 'config/inbox.stub', {})
  await codemods.makeUsingStub(stubsRoot, 'migrations/create_inbox_tables.stub', {
    migration: { fileName: `${Date.now()}_create_inbox_tables.ts` },
  })

  for (const role of MODEL_ROLES) await codemods.makeUsingStub(stubsRoot, modelStubOf(role), {})

  command.ui
    .instructions()
    .heading('Create the inbox tables, which also regenerates database/schema.ts')
    .add('node ace migration:run')
    .render()
}
