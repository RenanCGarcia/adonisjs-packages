import { defineConfig, drivers } from '@adonisjs/core/encryption'

// Booting the app needs an encryptor, and nothing in the fixture encrypts a real secret.
export default defineConfig({
  default: 'gcm',
  list: {
    gcm: drivers.aes256gcm({ keys: ['inbox-fixture-key-not-a-secret'], id: 'gcm' }),
  },
})
