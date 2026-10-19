import { readFile } from 'node:fs/promises'

import { BaseModel } from '@adonisjs/lucid/orm'
import { test } from '@japa/runner'

import { modelStubOf } from '../configure.ts'
import { INBOX_MIXINS } from '../src/mixins/main.ts'
import { MODEL_ROLES } from '../src/models.ts'
import { stubsRoot } from '../stubs/main.ts'

const roles = MODEL_ROLES.map(role => ({ role }))

test.group('model roles', () => {
  test('the {role} mixin tags the model with its role')
    .with(roles)
    .run(({ assert }, { role }) => {
      const model = INBOX_MIXINS[role]()(class extends BaseModel {})

      assert.equal(model.inboxRole, role)
    })

  test('configure scaffolds a {role} model composed with its mixin')
    .with(roles)
    .run(async ({ assert }, { role }) => {
      const stub = await readFile(`${stubsRoot}/${modelStubOf(role)}`, 'utf8')

      assert.include(stub, `withInbox${role[0]?.toUpperCase()}${role.slice(1)}()`)
    })
})
