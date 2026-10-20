import type Configure from '@adonisjs/core/commands/configure'

import { publishMigrations } from './src/migrations.ts'
import { MODEL_ROLES } from './src/models.ts'
import { INBOX_MIGRATIONS } from './src/schema.ts'
import { stubsRoot } from './stubs/main.ts'

export function modelStubOf(role: (typeof MODEL_ROLES)[number]) {
  return `models/${role.replace(/[A-Z]/g, letter => `_${letter.toLowerCase()}`)}.stub`
}

export async function configure(command: Configure) {
  const codemods = await command.createCodemods()

  await codemods.updateRcFile(rcFile => {
    rcFile.addProvider('@enzopita/adonisjs-inbox/inbox_provider')
    rcFile.addCommand('@enzopita/adonisjs-inbox/commands')
  })

  await codemods.makeUsingStub(stubsRoot, 'config/inbox.stub', {})

  for (const { path } of await publishMigrations(command.app, INBOX_MIGRATIONS)) {
    command.logger.action(`create ${command.app.relativePath(path)}`).succeeded()
  }

  for (const role of MODEL_ROLES) await codemods.makeUsingStub(stubsRoot, modelStubOf(role), {})

  command.ui
    .instructions()
    .heading('Create the inbox tables, then run the tick every minute from cron or a scheduler')
    .add('node ace migration:run')
    .add('node ace inbox:tick')
    .render()
}
