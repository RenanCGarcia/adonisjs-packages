import { Session } from 'node:inspector'
import { SourceMap } from 'node:module'
import { runInThisContext } from 'node:vm'
import ts from 'typescript'
import { test } from '@japa/runner'
import { locateFunctions } from '../src/routes/function_location.ts'
import { inlineMiddleware } from '../src/routes/inline_middleware.ts'

test.group('locateFunctions', group => {
  const { connect, post } = Session.prototype
  const { findEntry } = SourceMap.prototype

  group.each.teardown(() => {
    Session.prototype.connect = connect
    Session.prototype.post = post
    SourceMap.prototype.findEntry = findEntry
  })

  const failConnect = () => {
    Session.prototype.connect = () => {
      throw new Error('Inspector is not available')
    }
  }

  test('locates nothing without an inspector, and says why', ({ assert }) => {
    failConnect()

    const { found, failures } = locateFunctions([() => {}])

    assert.equal(found.size, 0)
    assert.equal(failures[0]?.message, 'Inspector is not available')
  })

  test('locates nothing when the inspector protocol fails, and says why', ({ assert }) => {
    Session.prototype.post = (...args: unknown[]) => {
      const callback = args.at(-1)

      if (callback instanceof Function) callback(new Error('protocol failure'))
    }

    const { found, failures } = locateFunctions([() => {}])

    assert.equal(found.size, 0)
    assert.equal(failures[0]?.message, 'protocol failure')
  })

  test('says why when the mapping of a location throws', ({ assert }) => {
    SourceMap.prototype.findEntry = () => {
      throw new Error('mapping failure')
    }

    const { failures } = locateFunctions([() => {}])

    assert.equal(failures[0]?.message, 'mapping failure')
  })

  test('says why when a source map is unreadable', ({ assert }) => {
    const fn = runInThisContext('(() => {})\n//# sourceMappingURL=data:application/json,not-json', {
      filename: 'file:///unreadable-map.js',
    })

    const { found, failures } = locateFunctions([fn])

    assert.equal(found.size, 0)
    assert.instanceOf(failures[0], SyntaxError)
  })

  test('an unreadable source map fails only the functions of its script', ({ assert }) => {
    const bad = runInThisContext(
      '(() => {})\n//# sourceMappingURL=data:application/json,not-json',
      {
        filename: 'file:///bad-map.js',
      },
    )

    const good = runInThisContext('(() => {})', { filename: 'file:///good.js' })

    const { found, failures } = locateFunctions([bad, good])

    assert.isFalse(found.has(bad))
    assert.deepEqual(found.get(good), { file: '/good.js', line: 0, column: 1 })
    assert.lengthOf(failures, 1)
  })

  test('reports no failure when every function is located', ({ assert }) => {
    const { found, failures } = locateFunctions([() => {}])

    assert.equal(found.size, 1)
    assert.lengthOf(failures, 0)
  })

  test('counts distinct errors, not functions, in the failed lookup', ({ assert }) => {
    const mapped = (name: string, map: string): Function[] =>
      runInThisContext(`[() => 1, () => 2]\n//# sourceMappingURL=data:application/json,${map}`, {
        filename: `file:///${name}.js`,
      })

    const functions = [...mapped('one', 'not-json'), ...mapped('two', '%7B%7D')]
    const middleware = functions.map(fn => ({ source: fn.toString(), fn }))
    const { find, diagnostics } = inlineMiddleware(ts.createProgram([], {}), middleware)

    find(middleware[0]!)

    assert.lengthOf(diagnostics, 1)
    assert.include(diagnostics[0]!.message, ', and 1 more)')
    assert.include(diagnostics[0]!.fix, 'register the middleware as a named middleware')
  })

  test('reports a failed lookup once, and still answers', ({ assert }) => {
    failConnect()

    const middleware = [() => 1, () => 2].map(fn => ({ source: fn.toString(), fn }))
    const { find, diagnostics } = inlineMiddleware(ts.createProgram([], {}), middleware)

    for (const each of middleware) assert.deepEqual(find(each), { kind: 'missing' })

    assert.lengthOf(diagnostics, 1)
    assert.equal(diagnostics[0]!.code, 'OA-R005')
    assert.include(diagnostics[0]!.message, 'Inspector is not available')
  })
})
