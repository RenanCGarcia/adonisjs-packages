import { defineConfig } from '@adonisjs/core/app'

export default defineConfig({
  commands: [
    () => import('@adonisjs/core/commands'),
    () => import('@adonisjs/lucid/commands'),
    () => import('@enzopita/adonisjs-inbox/commands'),
  ],
  providers: [
    () => import('@adonisjs/core/providers/app_provider'),
    () => import('@adonisjs/lucid/database_provider'),
    () => import('@enzopita/adonisjs-inbox/inbox_provider'),
  ],
})
