import { test } from '@japa/runner'
import { mergeSchemas } from '../../src/document/validator_schemas.ts'

test.group('mergeSchemas', () => {
  test('takes the TypeScript shape when Vine has no schema', ({ assert }) => {
    const typed = { type: 'string' }

    assert.deepEqual(mergeSchemas(undefined, typed), typed)
    assert.deepEqual(mergeSchemas({}, typed), typed)
  })

  test('takes the Vine schema when either side has no properties', ({ assert }) => {
    const vine = { type: 'string', format: 'email' }

    assert.deepEqual(mergeSchemas(vine, { type: 'string' }), vine)
    assert.deepEqual(
      mergeSchemas({ type: 'object', properties: { a: { type: 'string' } } }, { type: 'object' }),
      { type: 'object', properties: { a: { type: 'string' } } },
    )
  })

  test('fills a property Vine left empty from the TypeScript shape', ({ assert }) => {
    const merged = mergeSchemas(
      { type: 'object', properties: { avatar: {}, name: { type: 'string', format: 'email' } } },
      {
        type: 'object',
        properties: { avatar: { type: 'string', format: 'binary' }, name: { type: 'string' } },
      },
    )

    assert.deepEqual(merged.properties, {
      avatar: { type: 'string', format: 'binary' },
      name: { type: 'string', format: 'email' },
    })
  })

  test('merges nested objects', ({ assert }) => {
    const merged = mergeSchemas(
      { type: 'object', properties: { profile: { type: 'object', properties: { bio: {} } } } },
      {
        type: 'object',
        properties: { profile: { type: 'object', properties: { bio: { type: 'string' } } } },
      },
    )

    assert.deepEqual(merged.properties?.profile?.properties, { bio: { type: 'string' } })
  })

  test('drops the property only the TypeScript shape has', ({ assert }) => {
    const merged = mergeSchemas(
      { type: 'object', properties: { a: { type: 'string' } } },
      { type: 'object', properties: { a: { type: 'string' }, b: { type: 'number' } } },
    )

    assert.deepEqual(Object.keys(merged.properties!), ['a'])
  })

  test('requires the properties either side requires', ({ assert }) => {
    const properties = { a: { type: 'string' }, b: { type: 'string' }, c: { type: 'string' } }

    const merged = mergeSchemas(
      { type: 'object', properties, required: ['a'] },
      { type: 'object', properties, required: ['b', 'zzz'] },
    )

    assert.deepEqual(merged.required, ['a', 'b'])
  })

  test('has no required keyword when neither side requires a property', ({ assert }) => {
    const merged = mergeSchemas(
      { type: 'object', properties: { a: { type: 'string' } } },
      { type: 'object', properties: { a: { type: 'string' } } },
    )

    assert.notProperty(merged, 'required')
  })
})
