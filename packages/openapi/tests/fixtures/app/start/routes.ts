import { middleware } from '#start/kernel'
import router from '@adonisjs/core/services/router'
import { openapiRoutes } from '@enzopita/adonisjs-openapi/routes'

const AccessTokensController = () => import('#controllers/access_tokens_controller')
const AvatarController = () => import('#controllers/avatar_controller')
const NewAccountController = () => import('#controllers/new_account_controller')
const ProfileController = () => import('#controllers/profile_controller')
const UsersController = () => import('#controllers/users_controller')

router.get('/', () => {
  return { hello: 'world' }
})

router
  .group(() => {
    router
      .group(() => {
        router.post('signup', [NewAccountController, 'store'])
        router.post('login', [AccessTokensController, 'store'])
      })
      .prefix('auth')
      .as('auth')

    router
      .group(() => {
        router.get('profile', [ProfileController, 'show'])
        router.post('logout', [AccessTokensController, 'destroy'])
        router.put('avatar', [AvatarController, 'update']).use(middleware.tenant())
        router.delete('avatar', [AvatarController, 'destroy']).use(middleware.tenant())
      })
      .prefix('account')
      .as('profile')
      .use(middleware.auth())

    router
      .group(() => {
        router.get('/', [UsersController, 'index'])
        router.get('/:id', [UsersController, 'show'])
      })
      .prefix('users')
      .as('users')
  })
  .prefix('/api/v1')

// Left out of the document by the routes.except of config/openapi.ts.
router.get('/internal/users', [UsersController, 'index']).as('internal.users')

openapiRoutes().use(middleware.auth({ guards: ['basic'] }))
