import { compose } from '@adonisjs/core/helpers'
import { belongsTo, hasMany } from '@adonisjs/lucid/orm'
import type { BelongsTo, HasMany } from '@adonisjs/lucid/types/relations'
import { withInboxFlow } from '@enzopita/adonisjs-inbox-flows/mixins'
import { InboxFlowSchema } from '#database/schema'
import FlowBinding from '#models/inbox/flow_binding'
import FlowVersion from '#models/inbox/flow_version'

export default class Flow extends compose(InboxFlowSchema, withInboxFlow()) {
  static table = 'inbox_flows'

  @hasMany(() => FlowVersion)
  declare versions: HasMany<typeof FlowVersion>

  @belongsTo(() => FlowVersion, { foreignKey: 'publishedVersionId' })
  declare publishedVersion: BelongsTo<typeof FlowVersion>

  @hasMany(() => FlowBinding)
  declare bindings: HasMany<typeof FlowBinding>
}
