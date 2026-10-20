import { QueryClient } from '@tanstack/react-query'
import { createTuyau, TuyauError } from '@tuyau/core/client'
import { createTuyauReactQueryClient } from '@tuyau/react-query'
import { registry } from 'playground/registry'

import { sessions } from './sessions.ts'

export const client = createTuyau({
  baseUrl: window.location.origin,
  registry,
  headers: { Accept: 'application/json' },
  hooks: {
    beforeRequest: [
      request => {
        const session = sessions.current()

        if (session !== null) request.headers.set('Authorization', `Bearer ${session.token}`)
      },
    ],
    afterResponse: [
      (request, _options, response) => {
        const session = sessions.current()

        // A token the server no longer knows signs that agent out, back to the login screen.
        if (response.status === 401 && session !== null && request.headers.has('Authorization')) {
          sessions.signOut(session.user.email)
        }
      },
    ],
  },
})

export const api = createTuyauReactQueryClient({ client })

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: (failures, error) =>
        failures < 2 && !(error instanceof TuyauError && error.kind === 'http'),
    },
  },
})
