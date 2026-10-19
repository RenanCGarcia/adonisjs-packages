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
  })
  .prefix('/api/v1')

router
  .group(() => {
    router.post('queues', [controllers.InboxQueues, 'store'])
    router.post('queues/:id/members', [controllers.InboxQueues, 'addMember'])
    router.delete('queues/:id/members/:userId', [controllers.InboxQueues, 'removeMember'])
    router.post('attendants/:userId/deactivate', [controllers.InboxAttendants, 'deactivate'])
    router.post('channels', [controllers.InboxConversations, 'storeChannel'])
    router.post('channels/:id/conversations', [controllers.InboxConversations, 'store'])
    router.post('conversations/:id/tickets', [controllers.InboxConversations, 'openTicket'])
    router.post('tickets/:id/assume', [controllers.InboxTickets, 'assume'])
    router.post('tickets/:id/assign', [controllers.InboxTickets, 'assign'])
    router.post('tickets/:id/transfer', [controllers.InboxTickets, 'transfer'])
    router.post('tickets/:id/return', [controllers.InboxTickets, 'requeue'])
    router.post('tickets/:id/close', [controllers.InboxTickets, 'close'])
    router.post('tickets/:id/read', [controllers.InboxTickets, 'read'])
    router.post('tickets/:id/messages', [controllers.InboxMessages, 'store'])
  })
  .prefix('/inbox')
  .as('inbox')
  .use(middleware.auth())

router.post('/inbox/webhooks/:token', [controllers.InboxWebhooks, 'store']).as('inbox.webhooks')

openapiRoutes().use(middleware.auth({ guards: ['basic'] }))
