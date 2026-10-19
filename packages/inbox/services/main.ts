import app from '@adonisjs/core/services/app'

import type { Inbox } from '../src/inbox.ts'

let inbox: Inbox

await app.booted(async () => {
  inbox = await app.container.make('inbox')
})

export { inbox as default }
