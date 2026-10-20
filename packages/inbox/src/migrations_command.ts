import { BaseCommand, flags } from '@adonisjs/core/ace'

import { missingMigrations, publishMigrations, type MigrationManifest } from './migrations.ts'

/**
 * The command a package names `<package>:migrations`, over its own manifest.
 */
export abstract class MigrationsCommand extends BaseCommand {
  static description =
    'Publish the migrations this version of the package needs and your app lacks, never touching the ones you have'

  @flags.boolean({ description: 'Publish nothing, and exit with 1 when a migration is missing' })
  declare check: boolean

  protected abstract manifest: MigrationManifest<string>

  async run() {
    const directory = this.app.relativePath(this.app.migrationsPath())

    if (this.check) {
      const missing = await missingMigrations(this.app, this.manifest)

      if (missing.length === 0) {
        this.logger.success(`${this.manifest.package}: ${directory} has every migration`)

        return
      }

      this.logger.error(
        `${this.manifest.package}: ${directory} lacks ${missing.map(entry => `${entry.id}_${entry.name}`).join(', ')}. Run "node ace ${this.manifest.command}"`,
      )

      this.exitCode = 1

      return
    }

    const published = await publishMigrations(this.app, this.manifest)

    if (published.length === 0) {
      this.logger.info(`${this.manifest.package}: ${directory} has every migration`)

      return
    }

    for (const { path } of published) {
      this.logger.action(`create ${this.app.relativePath(path)}`).succeeded()
    }

    this.logger.info('Run "node ace migration:run" to apply them')
  }
}
