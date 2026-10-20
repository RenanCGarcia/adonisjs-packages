import type Channel from '#models/inbox/channel'
import { BaseTransformer } from '@adonisjs/core/transformers'

/**
 * A channel with its `defaultQueue` preloaded. The credentials and webhook token stay out.
 */
export default class ChannelTransformer extends BaseTransformer<Channel> {
  toObject() {
    const { defaultQueue } = this.resource

    return {
      ...this.pick(this.resource, ['id', 'name', 'provider', 'status', 'archivedAt']),
      defaultQueue: { id: defaultQueue.id, name: defaultQueue.name },
    }
  }
}
