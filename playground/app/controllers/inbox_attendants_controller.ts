import Attendant from '#models/inbox/attendant'
import Queue from '#models/inbox/queue'
import User from '#models/user'
import AgentTransformer from '#transformers/agent_transformer'
import { agentValidator } from '#validators/inbox'
import type { HttpContext } from '@adonisjs/core/http'
import inbox from '@enzopita/adonisjs-inbox/services/main'

/**
 * The human attendants who can log in, with what the agent transformer reads.
 */
function agents() {
  return Attendant.query()
    .where('kind', 'human')
    .has('user')
    .preload('user')
    .preload('memberships', memberships => memberships.orderBy('queueId').preload('queue'))
    .withCount('tickets', tickets => tickets.where('status', 'in_progress'))
    .orderBy('id')
}

export default class InboxAttendantsController {
  async index({ serialize }: HttpContext) {
    return serialize(AgentTransformer.transform(await agents()))
  }

  /**
   * A new user who can log in, as an attendant in the given queues.
   */
  async store({ request, response, serialize }: HttpContext) {
    const { queueIds = [], ...account } = await request.validateUsing(agentValidator)
    const queues = await Promise.all(queueIds.map(id => Queue.findOrFail(id)))
    const user = await User.create(account)
    const attendant = await inbox.attendants.forUser(user.id)

    for (const queue of queues) await inbox.queues.addMember(queue.id, attendant)

    const agent = await agents().where('id', attendant.id).firstOrFail()

    return response.created(await serialize(AgentTransformer.transform(agent)))
  }

  async deactivate({ params, response }: HttpContext) {
    await inbox.attendants.deactivate(await inbox.attendants.forUser(Number(params.userId)))

    return response.noContent()
  }
}
