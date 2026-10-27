import { errors as lucidErrors } from '@adonisjs/lucid'
import { errors as bouncerErrors } from '@adonisjs/bouncer'
import { errors as limiterErrors } from '@adonisjs/limiter'
import { defineConfig } from '@enzopita/adonisjs-openapi'

export default defineConfig({
  output: 'openapi.json',
  document: {
    info: { title: 'API', version: '1.0.0' },
    tags: [
      { name: 'Auth', description: 'Sign up and log in' },
      { name: 'Account', description: 'The signed-in user' },
      { name: 'Users', description: 'Public user profiles' },
      { name: 'Directory', description: 'Listings of many users' },
      { name: 'Webhooks', description: 'Events other services post' },
      { name: 'Probe', description: 'Handler patterns the generator documents' },
    ],
  },
  security: {
    schemes: {
      accessToken: { type: 'http', scheme: 'bearer' },
      tenant: { type: 'apiKey', in: 'header', name: 'X-Tenant-Id' },
    },
    middleware: {
      auth: 'accessToken',
      tenant: 'tenant',
    },
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
