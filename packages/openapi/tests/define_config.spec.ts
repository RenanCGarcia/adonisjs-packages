import { test } from '@japa/runner'

test.group('defineConfig', () => {
  test('rejects the 0.x keys with where each one went', async ({ assert }) => {
    const { defineConfig } = await import('../src/define_config.ts')

    assert.throws(
      // SAFETY: a JavaScript config has no types to reject the removed keys, which is what this checks.
      () => defineConfig({ info: { title: 'API' }, errorResponse: 'ApiError' } as never),
      /"info" is now "document\.info", "errorResponse" is now "errors\.body"/,
    )
  })

  test('merges document and security over the defaults', async ({ assert }) => {
    const { defineConfig } = await import('../src/define_config.ts')

    const config = defineConfig({ document: { servers: [{ url: 'https://api.test' }] } })

    assert.deepEqual(config.document, {
      info: { title: 'API', version: '1.0.0' },
      servers: [{ url: 'https://api.test' }],
      tags: [],
    })
    assert.deepEqual(config.security, { schemes: {}, middleware: {} })
  })
})
