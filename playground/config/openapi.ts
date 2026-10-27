import { errors as lucidErrors } from '@adonisjs/lucid'
import { errors as bouncerErrors } from '@adonisjs/bouncer'
import { errors as limiterErrors } from '@adonisjs/limiter'
import { defineConfig } from '@enzopita/adonisjs-openapi'

export default defineConfig({
  output: 'openapi.json',
  info: { title: 'API', version: '1.0.0' },
  tags: [{ name: 'Users', description: 'Public user profiles' }],
  securitySchemes: {
    accessToken: { type: 'http', scheme: 'bearer' },
    tenant: { type: 'apiKey', in: 'header', name: 'X-Tenant-Id' },
  },
  middlewareSecurity: {
    auth: 'accessToken',
    tenant: 'tenant',
  },
  errors: {
    throwers: {
      'bouncer.authorize': bouncerErrors.E_AUTHORIZATION_FAILURE,
      'findOrFail': lucidErrors.E_ROW_NOT_FOUND,
    },
    middleware: {
      globalThrottle: limiterErrors.E_TOO_MANY_REQUESTS,
    },
  },
})
