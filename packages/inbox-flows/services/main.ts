import app from '@adonisjs/core/services/app'

import type { InboxFlows } from '../src/inbox_flows.ts'

let inboxFlows: InboxFlows

await app.booted(async () => {
  inboxFlows = await app.container.make('inboxFlows')
})

export { inboxFlows as default }
