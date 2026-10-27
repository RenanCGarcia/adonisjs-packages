import { test } from '@japa/runner'

test.group('defineConfig', () => {
  test('rejects the removed errorResponse option', async ({ assert }) => {
    const { defineConfig } = await import('../src/define_config.ts')

    assert.throws(
      // SAFETY: a JavaScript config has no types to reject the removed option, which is what this checks.
      () => defineConfig({ errorResponse: 'ApiError' } as never),
      'openapi: "errorResponse" is removed, set the error body type in "errors.body"',
    )
  })
})
