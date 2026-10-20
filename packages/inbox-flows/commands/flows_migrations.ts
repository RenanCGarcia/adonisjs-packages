import { MigrationsCommand } from '@enzopita/adonisjs-inbox/migrations_command'

import { FLOWS_MIGRATIONS } from '../src/schema.ts'

export default class FlowsMigrations extends MigrationsCommand {
  static commandName = 'flows:migrations'

  protected manifest = FLOWS_MIGRATIONS
}
