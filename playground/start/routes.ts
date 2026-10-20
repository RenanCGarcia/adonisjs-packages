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

router.get('/console', [controllers.InboxConsole, 'show']).as('inbox.console')

router
  .group(() => {
    router.get('tickets', [controllers.InboxTickets, 'index'])
    router.get('tickets/:id', [controllers.InboxTickets, 'show'])
    router.get('attendants', [controllers.InboxAttendants, 'index'])
    router.post('attendants', [controllers.InboxAttendants, 'store'])
    router.get('queues', [controllers.InboxQueues, 'index'])
    router.get('channels', [controllers.InboxChannels, 'index'])
    router.post('channels/:id/simulate-inbound', [controllers.InboxChannels, 'inbound'])
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

router
  .group(() => {
    router.get('catalog', [controllers.InboxFlows, 'catalog'])
    router.post('/', [controllers.InboxFlows, 'store'])
    router.get(':id', [controllers.InboxFlows, 'show'])
    router.put(':id/draft', [controllers.InboxFlows, 'saveDraft'])
    router.post(':id/validate', [controllers.InboxFlows, 'validate'])
    router.post(':id/publish', [controllers.InboxFlows, 'publish'])
    router.get(':id/versions', [controllers.InboxFlows, 'versions'])
    router.post(':id/versions/:versionId/restore', [controllers.InboxFlows, 'restore'])
    router.get(':id/bindings', [controllers.InboxFlows, 'bindings'])
    router.put(':id/bindings', [controllers.InboxFlows, 'setBindings'])
    router.post('tickets/:id/start', [controllers.InboxFlows, 'start'])
    router.post('tickets/:id/stop', [controllers.InboxFlows, 'stop'])
    router.get('tickets/:id/runs', [controllers.InboxFlows, 'runs'])
  })
  .prefix('/inbox/flows')
  .as('inbox.flows')
  .use(middleware.auth())

router.post('/inbox/webhooks/:token', [controllers.InboxWebhooks, 'store']).as('inbox.webhooks')

openapiRoutes().use(middleware.auth({ guards: ['basic'] }))
