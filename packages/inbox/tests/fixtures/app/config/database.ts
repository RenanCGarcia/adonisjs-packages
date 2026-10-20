import app from '@adonisjs/core/services/app'
import { defineConfig } from '@adonisjs/lucid'

import env from '#start/env'

const migrations = { naturalSort: true, paths: ['database/migrations'] }
const schemaGeneration = { enabled: true, rulesPaths: ['./database/schema_rules.js'] }

export default defineConfig({
  connection: env.get('DB_CONNECTION', 'sqlite'),

  connections: {
    sqlite: {
      client: 'better-sqlite3',
      connection: { filename: app.tmpPath('db.sqlite3') },
      useNullAsDefault: true,
      migrations,
      schemaGeneration,
    },

    pg: {
      client: 'pg',
      connection: {
        host: env.get('DB_HOST'),
        port: env.get('DB_PORT'),
        user: env.get('DB_USER'),
        password: env.get('DB_PASSWORD'),
        database: env.get('DB_DATABASE'),
      },
      migrations,
      schemaGeneration,
    },
  },
})
