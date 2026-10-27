import { errors as authErrors } from '@adonisjs/auth'
import { errors as bouncerErrors } from '@adonisjs/bouncer'
import { errors as limiterErrors } from '@adonisjs/limiter'
import { defineConfig } from '@enzopita/adonisjs-openapi'
import LedgerException from '#exceptions/ledger_exception'

export default defineConfig({
  document: { tags: [{ name: 'Broken' }] },
  rules: { summaryMaxLength: 30, summaryTrailingPeriod: false },
  errors: {
    throwers: {
      'verifyCredentials': authErrors.E_INVALID_CREDENTIALS,
      'ledger.reject': LedgerException,
      'bouncer.authorise': bouncerErrors.E_AUTHORIZATION_FAILURE,
    },
    middleware: { '#start/limiter': limiterErrors.E_TOO_MANY_REQUESTS },
  },
})
