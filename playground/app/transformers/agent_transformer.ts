import type Attendant from '#models/inbox/attendant'
import { BaseTransformer } from '@adonisjs/core/transformers'

/**
 * A human attendant with `user` and `memberships.queue` preloaded, and its in-progress
 * `tickets` counted.
 */
export default class AgentTransformer extends BaseTransformer<Attendant> {
  toObject() {
    const { user, memberships } = this.resource

    return {
      id: this.resource.id,
      userId: user.id,
      name: user.fullName,
      email: user.email,
      active: this.resource.deactivatedAt === null,
      queues: memberships.map(({ queue }) => ({ id: queue.id, name: queue.name })),
      openTickets: this.withCount('tickets'),
    }
  }
}
