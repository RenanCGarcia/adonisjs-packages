import type Configure from '@adonisjs/core/commands/configure'

import { FLOWS_MODEL_ROLES } from './src/models.ts'
import { stubsRoot } from './stubs/main.ts'

export function modelStubOf(role: (typeof FLOWS_MODEL_ROLES)[number]) {
  return `models/${role.replace(/[A-Z]/g, letter => `_${letter.toLowerCase()}`)}.stub`
}

export async function configure(command: Configure) {
  const codemods = await command.createCodemods()

  await codemods.updateRcFile(rcFile => {
    rcFile.addProvider('@enzopita/adonisjs-inbox-flows/inbox_flows_provider')
    rcFile.addCommand('@enzopita/adonisjs-inbox-flows/commands')
  })

  await codemods.makeUsingStub(stubsRoot, 'config/inbox_flows.stub', {})
  await codemods.makeUsingStub(stubsRoot, 'migrations/create_inbox_flows_tables.stub', {
    migration: { fileName: `${Date.now()}_create_inbox_flows_tables.ts` },
  })

  for (const role of FLOWS_MODEL_ROLES) {
    await codemods.makeUsingStub(stubsRoot, modelStubOf(role), {})
  }

  command.ui
    .instructions()
    .heading('Register the flows bot in config/inbox.ts, create the tables, then run the tick')
    .add("bots: { flows: () => import('@enzopita/adonisjs-inbox-flows/bot') }")
    .add('node ace migration:run')
    .add('node ace flows:tick (every minute, next to inbox:tick)')
    .render()
}
