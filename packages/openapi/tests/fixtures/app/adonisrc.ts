import { indexEntities } from '@adonisjs/core/generators'
import { defineConfig } from '@adonisjs/core/app'

export default defineConfig({
  commands: [
    () => import('@adonisjs/core/commands'),
    () => import('@adonisjs/lucid/commands'),
    () => import('@enzopita/adonisjs-openapi/commands'),
  ],
  providers: [
    () => import('@adonisjs/core/providers/app_provider'),
    () => import('@adonisjs/core/providers/hash_provider'),
    () => import('@adonisjs/core/providers/vinejs_provider'),
    () => import('@adonisjs/lucid/database_provider'),
    () => import('@adonisjs/auth/auth_provider'),
    () => import('#providers/api_provider'),
  ],
  preloads: [() => import('#start/routes'), () => import('#start/kernel')],
  hooks: {
    init: [indexEntities({ transformers: { enabled: true } })],
  },
})
