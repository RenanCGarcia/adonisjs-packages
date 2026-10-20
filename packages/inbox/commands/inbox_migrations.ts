import { INBOX_MIGRATIONS } from '../src/schema.ts'
import { MigrationsCommand } from '../src/migrations_command.ts'

export default class InboxMigrations extends MigrationsCommand {
  static commandName = 'inbox:migrations'

  protected manifest = INBOX_MIGRATIONS
}
