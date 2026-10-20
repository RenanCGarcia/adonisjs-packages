import { mkdir, readdir, writeFile } from 'node:fs/promises'
import { basename, dirname } from 'node:path'

import type { ApplicationService } from '@adonisjs/core/types'
import type { LucidModel } from '@adonisjs/lucid/types/model'

import { InboxError } from './errors.ts'

export interface MigrationEntry<Role extends string> {
  /**
   * Four digits. A released id is never renumbered or reused: a host's file carries it in its
   * name, and that is how the package knows the host has it.
   */
  readonly id: string

  /**
   * Snake case. The stub is `migrations/<id>_<name>.stub`.
   */
  readonly name: string

  /**
   * The columns this migration adds, by the role of the model that reads them.
   */
  readonly columns: { readonly [R in Role]?: readonly string[] }
}

export interface MigrationManifest<Role extends string> {
  /**
   * The package as error messages name it, such as `inbox-flows`. Published files are named
   * `<timestamp>_<package in snake case>_<id>_<name>.ts`.
   */
  readonly package: string

  /**
   * The ace command that publishes the missing migrations.
   */
  readonly command: string

  readonly stubsRoot: string
  readonly entries: ReadonlyArray<MigrationEntry<Role>>
}

export interface PublishedMigration<Role extends string> {
  readonly entry: MigrationEntry<Role>
  readonly path: string
}

export function defineMigrations<const Role extends string>(
  manifest: MigrationManifest<Role>,
): MigrationManifest<Role> {
  manifest.entries.forEach((entry, index) => {
    const previous = manifest.entries[index - 1]

    if (!/^\d{4}$/.test(entry.id) || (previous !== undefined && previous.id >= entry.id)) {
      throw new Error(`${manifest.package}: migration ids must be four digits, in increasing order`)
    }

    if (!/^[a-z0-9_]+$/.test(entry.name)) {
      throw new Error(`${manifest.package}: migration ${entry.id} needs a snake case name`)
    }
  })

  return manifest
}

const prefixOf = (manifest: MigrationManifest<string>) => manifest.package.replaceAll('-', '_')

async function migrationFiles(directory: string) {
  try {
    return (await readdir(directory, { recursive: true })).map(file => basename(file))
  } catch (error) {
    // SAFETY: readdir rejects with a system error, which carries a code.
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []
    throw error
  }
}

/**
 * The manifest's migrations with no file in the app's migrations directory, in manifest order.
 * A file counts by the id in its name alone, whatever its timestamp and its contents.
 */
export async function missingMigrations<Role extends string>(
  app: ApplicationService,
  manifest: MigrationManifest<Role>,
) {
  const files = await migrationFiles(app.migrationsPath())
  const named = new RegExp(`^\\d+_${prefixOf(manifest)}_(\\d{4})_`)
  const present = new Set(files.map(file => named.exec(file)?.[1]))

  return manifest.entries.filter(entry => !present.has(entry.id))
}

/**
 * Writes each missing migration, in manifest order, timestamped after every file already in the
 * directory so it runs after them. It never opens an existing file, so running it again finds
 * nothing to do.
 */
export async function publishMigrations<Role extends string>(
  app: ApplicationService,
  manifest: MigrationManifest<Role>,
): Promise<Array<PublishedMigration<Role>>> {
  const missing = await missingMigrations(app, manifest)

  if (missing.length === 0) return []

  const files = await migrationFiles(app.migrationsPath())
  const latest = Math.max(0, ...files.map(file => Number(/^(\d+)_/.exec(file)?.[1] ?? 0)))
  let timestamp = Math.max(Date.now(), latest + 1)

  const stubs = await app.stubs.create()
  const published: Array<PublishedMigration<Role>> = []

  for (const entry of missing) {
    const stub = await stubs.build(`migrations/${entry.id}_${entry.name}.stub`, {
      source: manifest.stubsRoot,
    })

    const fileName = `${timestamp++}_${prefixOf(manifest)}_${entry.id}_${entry.name}.ts`
    const { contents, destination } = await stub.prepare({ migration: { fileName } })

    await mkdir(dirname(destination), { recursive: true })
    await writeFile(destination, contents, { flag: 'wx' })

    published.push({ entry, path: destination })
  }

  return published
}

/**
 * Throws when `model` lacks a column the manifest's migrations add for `role`. The model's
 * columns come from `database/schema.ts`, which `migration:run` regenerates from the database,
 * so a host that upgraded the package without running its new migrations fails here instead of
 * reading `undefined` from a column it doesn't have.
 */
export function assertSchema<Role extends string>(
  manifest: MigrationManifest<Role>,
  role: Role,
  model: LucidModel,
) {
  model.boot()

  const columns = new Set([...model.$columnsDefinitions.values()].map(column => column.columnName))

  for (const entry of manifest.entries) {
    const missing = (entry.columns[role] ?? []).filter(column => !columns.has(column))

    if (missing.length > 0) {
      throw new InboxError(
        'E_INBOX_SCHEMA_OUTDATED',
        `${manifest.package}: ${model.name} has no ${missing.join(', ')} column, which the migration ${entry.id}_${entry.name} adds. Run "node ace ${manifest.command}", then "node ace migration:run"`,
      )
    }
  }
}
