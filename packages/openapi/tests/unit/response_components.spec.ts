import { test } from '@japa/runner'
import type ts from 'typescript'
import { ResponseComponents } from '../../src/document/response_components.ts'
import type { ResponseOwner } from '../../src/document/response_owner.ts'
import type { OpenApiResponse } from '../../src/types.ts'

const owner = (name: string): ResponseOwner => ({
  // SAFETY: `ResponseComponents` compares owners by symbol identity and never reads the symbol.
  symbol: { name } as ts.Symbol,
  name,
  file: `/app/app/exceptions/${name}.ts`,
})

const respond = (description: string): OpenApiResponse => ({ description })

test.group('ResponseComponents names', () => {
  test('numbers the bodies of one class and status in the order of their content', ({ assert }) => {
    const limit = owner('LimitException')
    const components = new ResponseComponents('/app')

    const zebra = components.ref(limit, '402', respond('zebra'))
    const apple = components.ref(limit, '402', respond('apple'))

    assert.deepEqual(components.responses(), {
      LimitException_1: respond('apple'),
      LimitException_2: respond('zebra'),
    })
    assert.equal(apple.$ref, '#/components/responses/LimitException_1')
    assert.equal(zebra.$ref, '#/components/responses/LimitException_2')
  })

  test('gives the same numbers whatever the order the bodies are met in', ({ assert }) => {
    const refs = (descriptions: string[]) => {
      const limit = owner('LimitException')
      const components = new ResponseComponents('/app')

      const made = descriptions.map(
        description => [description, components.ref(limit, '402', respond(description))] as const,
      )

      components.responses()

      return Object.fromEntries(made.map(([description, ref]) => [description, ref.$ref]))
    }

    assert.deepEqual(refs(['b', 'a', 'c']), refs(['c', 'a', 'b']))
    assert.deepEqual(refs(['b', 'a', 'c']), {
      a: '#/components/responses/LimitException_1',
      b: '#/components/responses/LimitException_2',
      c: '#/components/responses/LimitException_3',
    })
  })

  test('shares one component between the operations that answer with the same body', ({
    assert,
  }) => {
    const limit = owner('LimitException')
    const components = new ResponseComponents('/app')

    const first = components.ref(limit, '402', respond('same'))
    const second = components.ref(limit, '402', respond('same'))

    assert.deepEqual(components.responses(), { LimitException: respond('same') })
    assert.equal(first.$ref, '#/components/responses/LimitException')
    assert.equal(second.$ref, '#/components/responses/LimitException')
  })
})
