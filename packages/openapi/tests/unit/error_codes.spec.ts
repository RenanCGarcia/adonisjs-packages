import { test } from '@japa/runner'
import { errorCodes } from '../../src/document/error_codes.ts'
import type { JsonSchema, OpenApiDocument } from '../../src/types.ts'

const coded = (code: string): JsonSchema => ({
  type: 'object',
  properties: { code: { type: 'string', const: code } },
  required: ['code'],
})

const ref = (name: string): JsonSchema => ({ $ref: `#/components/schemas/${name}` })

const documentOf = (
  body: JsonSchema,
  schemas: Record<string, JsonSchema>,
): Pick<OpenApiDocument, 'paths' | 'components'> => ({
  paths: {
    '/things': {
      get: {
        operationId: 'getThings',
        responses: {
          '409': { description: 'Conflict', content: { 'application/json': { schema: body } } },
        },
      },
    },
  },
  components: { schemas, securitySchemes: {} },
})

test.group('errorCodes', () => {
  test('follows a $ref body to its component schema', ({ assert }) => {
    assert.deepEqual(errorCodes(documentOf(ref('Taken'), { Taken: coded('E_TAKEN') })), ['E_TAKEN'])
  })

  test('follows $refs inside oneOf and anyOf entries, however deep', ({ assert }) => {
    const body: JsonSchema = {
      oneOf: [ref('Taken'), { anyOf: [ref('Wrapped'), coded('E_INLINE')] }],
    }

    assert.deepEqual(
      errorCodes(
        documentOf(body, {
          Taken: coded('E_TAKEN'),
          Wrapped: { oneOf: [ref('Deep')] },
          Deep: coded('E_DEEP'),
        }),
      ),
      ['E_DEEP', 'E_INLINE', 'E_TAKEN'],
    )
  })

  test('stops at a cyclic $ref', ({ assert }) => {
    const schemas = {
      A: { oneOf: [ref('B'), coded('E_A')] },
      B: { oneOf: [ref('A'), coded('E_B')] },
    }

    assert.deepEqual(errorCodes(documentOf(ref('A'), schemas)), ['E_A', 'E_B'])
  })

  test('ignores a $ref that names no component schema', ({ assert }) => {
    assert.deepEqual(errorCodes(documentOf(ref('Missing'), {})), [])
  })
})
