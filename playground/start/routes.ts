/*
|--------------------------------------------------------------------------
| Routes file
|--------------------------------------------------------------------------
|
| The routes file is used for defining the HTTP routes.
|
*/

import { middleware } from '#start/kernel'
import router from '@adonisjs/core/services/router'
import { throttle } from '#start/limiter'
import { controllers } from '#generated/controllers'
import { openapiRoutes } from '@enzopita/adonisjs-openapi/routes'

router.get('/', () => {
  return { hello: 'world' }
})

router
  .group(() => {
    router
      .group(() => {
        router.post('signup', [controllers.NewAccount, 'store'])
        router.post('login', [controllers.AccessTokens, 'store'])
      })
      .prefix('auth')
      .as('auth')

    router
      .group(() => {
        router.get('profile', [controllers.Profile, 'show'])
        router.post('logout', [controllers.AccessTokens, 'destroy'])
        router.put('avatar', [controllers.Avatar, 'update']).use(middleware.tenant())
        router.delete('avatar', [controllers.Avatar, 'destroy']).use(middleware.tenant())
      })
      .prefix('account')
      .as('profile')
      .use(middleware.auth())

    router
      .group(() => {
        router.get('/', [controllers.Users, 'index'])
        router.get('/:id', [controllers.Users, 'show'])
      })
      .prefix('users')
      .as('users')

    router.post('webhooks/mail', [controllers.MailEvents, 'store']).as('webhooks.mail')

    router
      .group(() => {
        router.get('/', [controllers.Cart, 'show'])
        router.post('/', [controllers.Cart, 'store'])
      })
      .prefix('cart')

    router.post('forms/posts', [controllers.Posts, 'store']).as('forms.posts')

    router
      .group(() => {
        router.get('branches', [controllers.Probe, 'branches'])
        router.get('empty', [controllers.Probe, 'empty'])
        router.get('maybe', [controllers.Probe, 'maybe'])
        router.get('back', [controllers.Probe, 'back'])
        router.get('text', [controllers.Probe, 'text'])
        router.get('csv', [controllers.Probe, 'csv'])
        router.post('json-created', [controllers.Probe, 'jsonCreated'])
        router.get('limited', [controllers.Probe, 'limited'])
        router.post('sent', [controllers.Probe, 'sent'])
        router.get('aborted', [controllers.Probe, 'aborted'])
        router.get('download', [controllers.Probe, 'download'])
        router.get('attachment', [controllers.Probe, 'attachment'])
        router.get('report', [controllers.Probe, 'report'])
        router.get('export', [controllers.Probe, 'exported'])
        router.get('stream', [controllers.Probe, 'stream'])
        router.get('thrown', [controllers.Probe, 'thrown'])
        router
          .get('verified', [controllers.Probe, 'text'])
          .as('verified')
          .use(middleware.verifiedEmail())
        router.get('gated', [controllers.Probe, 'gated']).use(middleware.verifiedEmail())
        router.get('reasoned', [controllers.Probe, 'reasoned']).use(middleware.verifiedEmail())
        router.get('authorized', [controllers.Probe, 'authorized'])
        router
          .get('screened', [controllers.Probe, 'authorized'])
          .as('screened')
          .use(middleware.verifiedEmail())
        router
          .get('managed', [controllers.Probe, 'text'])
          .as('managed')
          .use(middleware.managesProbe())
        router.get('viewed', [controllers.Probe, 'viewed'])
        router.get('hidden', [controllers.Probe, 'hidden'])
        router.get('users/:id', [controllers.Probe, 'found'])
        router.get('plan', [controllers.Probe, 'plan'])
        router.get('seats', [controllers.Probe, 'seats'])
        router.get('maintenance', [controllers.Probe, 'maintenance'])
        router.get('upstream', [controllers.Probe, 'upstream'])
        router.get('throttled', [controllers.Probe, 'text']).as('throttled').use(throttle)
        router
          .get('secret', [controllers.Probe, 'text'])
          .as('secret')
          .use(async ({ request, response }, next) => {
            if (request.header('x-probe-secret') !== 'open sesame') {
              return response.unauthorized({
                code: 'E_WRONG_SECRET' as const,
                message: 'Send the probe secret',
              })
            }

            return next()
          })
        router.get('card', [controllers.Probe, 'card'])
        router.get('model', [controllers.Probe, 'model'])
        router.get('collections', [controllers.Probe, 'collections'])
        router.get('search', [controllers.Probe, 'search'])
        router.get('items/:id?', [controllers.Probe, 'item'])
        router.route('echo', ['GET', 'POST'], [controllers.Probe, 'echo'])
        router.post('paged', [controllers.Probe, 'paged'])
        router.post('nullable', [controllers.Probe, 'nullable'])
        router.route('head', ['HEAD'], [controllers.Probe, 'head'])
        router.get('closure', () => ({ ok: true })).as('closure')
      })
      .prefix('probe')
      .as('probe')
  })
  .prefix('/api/v1')

router
  .group(() => {
    router.get('redirect', [controllers.Github, 'redirect'])
    router.get('callback', [controllers.Github, 'callback'])
  })
  .prefix('oauth/github')

openapiRoutes().use(middleware.auth({ guards: ['basic'] }))
