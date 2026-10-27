import { fileURLToPath } from 'node:url'
import { errors as lucidErrors } from '@adonisjs/lucid'
import { errors as bouncerErrors } from '@adonisjs/bouncer'
import { errors as limiterErrors } from '@adonisjs/limiter'
import { defineConfig } from '@enzopita/adonisjs-openapi'

export default defineConfig({
  // Absolute, as a config may build it from the file's own URL.
  output: fileURLToPath(new URL('../tmp/absolute/openapi.json', import.meta.url)),
  security: {
    schemes: { accessToken: { type: 'http', scheme: 'bearer' } },
    middleware: { auth: 'accessToken' },
  },
  errors: {
    throwers: {
      'bouncer.authorize': bouncerErrors.E_AUTHORIZATION_FAILURE,
      'findOrFail': lucidErrors.E_ROW_NOT_FOUND,
    },
    middleware: { globalThrottle: limiterErrors.E_TOO_MANY_REQUESTS },
  },
})
