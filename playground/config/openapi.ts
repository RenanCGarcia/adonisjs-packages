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
})
