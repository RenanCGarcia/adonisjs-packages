import { defineConfig } from '../../src/define_config.ts'
import { InboxError } from '../../src/errors.ts'
import { assertSchema, type MigrationManifest } from '../../src/migrations.ts'
import { MODEL_ROLES, type ModelRole } from '../../src/models.ts'
import { bootApp, modelsIn } from '../../src/testing/app.ts'

/**
 * Prints the columns each inbox model of the app at argv[2] has, and what `assertSchema` makes
 * of them against the manifest in argv[3]. It runs in a process of its own because the models
 * extend the app's `database/schema.ts`, which each migration run rewrites.
 */
// SAFETY: migrations.spec.ts passes the app root and the manifest as JSON.
const [root, manifest] = process.argv.slice(2) as [string, string]

// SAFETY: as above, a manifest serialized by the spec.
const parsed = JSON.parse(manifest) as MigrationManifest<ModelRole>
const models = modelsIn(new URL(root))
const app = await bootApp(new URL(root), defineConfig({ models, bots: {}, channels: {} }))
const columns: Partial<Record<ModelRole, string[]>> = {}
let error: { code: string; message: string } | null = null

for (const role of MODEL_ROLES) {
  const { default: model } = await models[role]()

  model.boot()
  columns[role] = [...model.$columnsDefinitions.values()].map(column => column.columnName).sort()

  try {
    assertSchema(parsed, role, model)
  } catch (thrown) {
    if (!(thrown instanceof InboxError)) throw thrown

    error ??= { code: thrown.code, message: thrown.message }
  }
}

await app.terminate()

console.log(JSON.stringify({ columns, error }))
