import { Session } from 'node:inspector'
import { test } from '@japa/runner'
import { locateFunctions } from '../src/routes/function_location.ts'

test.group('locateFunctions', group => {
  const { connect, post } = Session.prototype

  group.each.teardown(() => {
    Session.prototype.connect = connect
    Session.prototype.post = post
  })

  test('locates nothing without an inspector', ({ assert }) => {
    Session.prototype.connect = () => {
      throw new Error('Inspector is not available')
    }

    assert.equal(locateFunctions([() => {}]).size, 0)
  })

  test('locates nothing when the inspector protocol fails', ({ assert }) => {
    Session.prototype.post = (...args: unknown[]) => {
      const callback = args.at(-1)

      if (callback instanceof Function) callback(new Error('protocol failure'))
    }

    assert.equal(locateFunctions([() => {}]).size, 0)
  })
})
