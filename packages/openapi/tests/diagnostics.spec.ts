import { cp, readFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { test } from '@japa/runner'
import type { OpenApiDocument } from '../src/types.ts'
import { brokenApp, generateInCopy, json, object, unauthorizedApp } from './support/playground.ts'

test.group('openapi:generate on an app whose handler renders E_UNAUTHORIZED_ACCESS', group => {
  let document: OpenApiDocument
  let dir: string
  let output: string

  group.setup(async () => {
    ;({ dir, output } = await generateInCopy(copy =>
      cp(fileURLToPath(unauthorizedApp), copy, { recursive: true }),
    ))
    document = JSON.parse(await readFile(join(dir, 'tmp/absolute/openapi.json'), 'utf8'))

    return () => rm(dir, { recursive: true })
  })

  test('writes an absolute output as given', ({ assert }) => {
    assert.include(output, 'OpenAPI document written to tmp/absolute/openapi.json')
  })

  test('documents the 401 of a secured route with the body of the handler branch', ({ assert }) => {
    assert.deepEqual(
      json(document.paths['/api/v1/account/profile']!.get!.responses['401']),
      object({
        code: { type: 'string', const: 'E_UNAUTHORIZED_ACCESS' },
        message: { type: 'string' },
      }),
    )
  })
})

test.group('openapi:generate on an app whose tags are wrong', group => {
  let output: string
  let dir: string

  group.setup(async () => {
    ;({ dir, output } = await generateInCopy(copy =>
      cp(fileURLToPath(brokenApp), copy, { recursive: true }),
    ))

    return () => rm(dir, { recursive: true })
  })

  test('fails and writes no document', async ({ assert }) => {
    assert.include(output, 'The errors above block the document')
    await assert.rejects(() => readFile(join(dir, 'openapi.json')))
  })

  test('rejects a numeric @throws and a union with the fix', ({ assert }) => {
    assert.include(
      output,
      'OA-T001 broken.numeric: @throws: 404 names a status code, not an exception class: use `@response {404} reason` to describe a derived status, `@response {404} {Type}` to declare a body, or `@throws {Class}`',
    )
    assert.include(
      output,
      'OA-T001 broken.union: @throws: PlanLimitException | MaintenanceException names several classes: write one @throws tag per class',
    )
  })

  test('rejects a @throws without braces with the fix', ({ assert }) => {
    assert.include(
      output,
      'OA-T001 broken.unbraced: @throws EmailTakenException has no braces around the class: write it as `@throws {EmailTakenException} reason`',
    )
    assert.include(
      output,
      'OA-T001 broken.unbraced_status: @throws 404 names a status code, not an exception class: use `@response {404} reason`',
    )
  })

  test('lists the candidates of a @throws class name that resolves to none or several', ({
    assert,
  }) => {
    assert.include(
      output,
      'OA-T002 broken.duplicate: @throws: LimitException: several exception classes are named LimitException: app/exceptions/billing/limit_exception.ts, app/exceptions/storage/limit_exception.ts',
    )
    assert.include(
      output,
      'OA-T002 broken.missing: @throws: QuotaException: no exception class of the app is named QuotaException',
    )
    assert.notInclude(output, 'broken.escaped')
  })

  test('rejects a @response reason for a status nothing documents', ({ assert }) => {
    assert.include(output, 'OA-T003 broken.underived: @response {418}: nothing documents a 418')
  })

  test('rejects a @response type it cannot read', ({ assert }) => {
    const errors = output.split('\n').filter(line => line.includes('[ error ]'))

    assert.isTrue(
      errors.some(line =>
        line.includes(
          'OA-T007 broken.inline: @response {502} {{ provider: string }}: an inline object type is not read: declare it as a type, such as `type Body = { provider: string }`, and write `@response {502} {Body}`',
        ),
      ),
    )
    assert.isTrue(
      errors.some(line =>
        line.includes(
          'OA-T007 broken.unresolved: @response {UpstreamFailure}: UpstreamFailure is not in scope',
        ),
      ),
    )
  })

  test('warns about @exception and points to @throws', ({ assert }) => {
    assert.include(
      output,
      'OA-T008 broken.aliased: @exception is not a tag the generator reads: use @throws {Class}',
    )
    assert.notInclude(output, 'OA-T001 broken.aliased')
  })

  test('warns about a tag the generator does not read', ({ assert }) => {
    // The route has an optional param, so two paths, and the warning once.
    assert.lengthOf(
      output.split('OA-T008 broken.misspelled: @reponse is not a tag the generator reads'),
      2,
    )
    assert.include(
      output,
      'OA-T008 broken.annotated: @summary is not a tag the generator reads: the first paragraph of the comment is the summary',
    )
    assert.notInclude(output, 'OA-T008 broken.annotated: @internal')
    assert.notInclude(output, 'OA-T008 broken.annotated: @todo')
  })

  test('warns about an @example it cannot read', ({ assert }) => {
    assert.include(
      output,
      'OA-T009 broken.examples: @example {200} missingExample: missingExample is not in scope',
    )
    assert.include(
      output,
      'OA-T009 broken.examples: @example {200} computedExample: computedExample is not a const holding JSON',
    )
    assert.include(
      output,
      'OA-T009 broken.examples: @example {200} mutableExample: mutableExample is not a const holding JSON',
    )
    assert.include(
      output,
      'OA-T009 broken.examples: @example {404}: no 404 with a body is documented for this route',
    )
    assert.notInclude(output, 'OA-T008 broken.examples')
  })

  test('warns about an operation without tags and a tag not declared', ({ assert }) => {
    assert.include(
      output,
      'OA-S001 style.untagged: the operation has no tags: add @tags to the action or to its controller class (app/controllers/style_controller.ts:2)',
    )
    assert.include(
      output,
      "OA-S002 style.wordy: the tag Styling is not declared: add { name: 'Styling' } to document.tags in config/openapi.ts",
    )
    assert.notInclude(output, 'the tag Broken is not declared')
  })

  test('checks the summary against the rules', ({ assert }) => {
    assert.include(output, 'OA-S003 style.wordy: the summary is longer than 30 characters')
    assert.include(output, 'OA-S004 style.wordy: the summary ends with a period')
    assert.notInclude(output, 'OA-S003 style.untagged')
  })

  test('warns that a package exception renders a body its declaration does not carry', ({
    assert,
  }) => {
    assert.include(output, 'OA-E002 E_INVALID_CREDENTIALS renders its own body')
  })

  test('reads the status of an errors entry without running its class', ({ assert }) => {
    assert.notInclude(output, 'LedgerException constructed')
    assert.notInclude(output, "errors.throwers['ledger.reject']")
    assert.notInclude(output, "errors.throwers['verifyCredentials']")
  })

  test('warns about an errors key that matches nothing', ({ assert }) => {
    assert.include(
      output,
      "OA-E003 errors.throwers['bouncer.authorise'] matches no call of the documented routes",
    )
    assert.include(
      output,
      "OA-E003 errors.middleware['#start/limiter'] matches no middleware of the documented routes: name the middleware as `node ace list:routes` shows it",
    )
  })
})
