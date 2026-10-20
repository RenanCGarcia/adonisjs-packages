import { defineConfig } from '@adonisjs/core/logger'

export default defineConfig({
  default: 'app',
  loggers: {
    app: { enabled: true, name: 'openapi-fixture', level: 'info' },
  },
})
