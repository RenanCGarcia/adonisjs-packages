import { compose } from '@adonisjs/core/helpers'
import { belongsTo } from '@adonisjs/lucid/orm'
import type { BelongsTo } from '@adonisjs/lucid/types/relations'
import { withInboxFlowVersion } from '@enzopita/adonisjs-inbox-flows/mixins'
import { InboxFlowVersionSchema } from '#database/schema'
import Flow from '#models/inbox/flow'

export default class FlowVersion extends compose(InboxFlowVersionSchema, withInboxFlowVersion()) {
  static table = 'inbox_flow_versions'

  @belongsTo(() => Flow)
  declare flow: BelongsTo<typeof Flow>
}
