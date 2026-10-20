import type Queue from '#models/inbox/queue'
import { BaseTransformer } from '@adonisjs/core/transformers'

/**
 * A queue with its `members` counted and its tickets counted as `queued` and `inProgress`.
 */
export default class QueueTransformer extends BaseTransformer<Queue> {
  toObject() {
    return {
      ...this.pick(this.resource, ['id', 'name']),
      members: this.withCount('members'),
      queued: this.withAggregate('queued'),
      inProgress: this.withAggregate('inProgress'),
    }
  }
}
