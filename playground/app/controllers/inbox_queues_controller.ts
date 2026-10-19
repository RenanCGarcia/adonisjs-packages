import Queue from '#models/inbox/queue'
import { memberValidator, queueValidator } from '#validators/inbox'
import type { HttpContext } from '@adonisjs/core/http'
import inbox from '@enzopita/adonisjs-inbox/services/main'

export default class InboxQueuesController {
  async store({ request, response }: HttpContext) {
    const { name } = await request.validateUsing(queueValidator)

    return response.created(await Queue.create({ name }))
  }

  async addMember({ params, request, response }: HttpContext) {
    const queue = await Queue.findOrFail(params.id)
    const { userId } = await request.validateUsing(memberValidator)

    await inbox.queues.addMember(queue.id, await inbox.attendants.forUser(userId))

    return response.noContent()
  }

  async removeMember({ params, response }: HttpContext) {
    const queue = await Queue.findOrFail(params.id)

    await inbox.queues.removeMember(queue.id, await inbox.attendants.forUser(Number(params.userId)))

    return response.noContent()
  }
}
