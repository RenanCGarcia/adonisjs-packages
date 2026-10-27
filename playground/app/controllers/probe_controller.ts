import { Readable } from 'node:stream'
import { fileURLToPath } from 'node:url'
import { Exception } from '@adonisjs/core/exceptions'
import User from '#models/user'
import EmailTakenException from '#exceptions/email_taken_exception'
import { echoProbeValidator, searchProbeValidator } from '#validators/probe'
import type { HttpContext } from '@adonisjs/core/http'

const manifest = fileURLToPath(new URL('../../package.json', import.meta.url))

/**
 * Handler patterns whose responses are not a single returned body.
 */
export default class ProbeController {
  async branches({ request, response, serialize }: HttpContext) {
    if (request.input('x')) return response.created({ created: true as const })
    if (request.input('y')) return serialize({ serialized: 1 })
    return { plain: 'yes' }
  }

  async empty() {
    return null
  }

  async maybe({ request }: HttpContext) {
    if (request.input('x')) return { found: true }
  }

  async back({ response }: HttpContext) {
    return response.redirect('/')
  }

  async text() {
    return 'pong'
  }

  async csv({ response }: HttpContext) {
    response.header('content-type', 'text/csv')
    return 'id,email'
  }

  async jsonCreated({ response }: HttpContext) {
    response.status(201)
    return response.json({ id: 1 })
  }

  async limited({ response }: HttpContext) {
    response.header('Retry-After', '10')
    return response.tooManyRequests({ message: 'Slow down' })
  }

  async sent({ response }: HttpContext) {
    response.accepted({ queued: true })
  }

  async aborted(ctx: HttpContext) {
    ctx.response.abortIf(!ctx.request.input('token'), { message: 'Missing token' }, 403)
    ctx.response.abort({ message: 'Gone for good' }, 410)
  }

  async download({ response }: HttpContext) {
    response.download(manifest)
  }

  async attachment({ response }: HttpContext) {
    response.attachment(manifest, 'package.json')
  }

  async stream({ response }: HttpContext) {
    response.stream(Readable.from(['a', 'b']))
  }

  async thrown({ request }: HttpContext) {
    if (request.input('email')) throw new EmailTakenException(request.input('email'))
    return { available: true }
  }

  /**
   * @throws {403} Lacks `probe.manage`
   */
  async gated({ request }: HttpContext) {
    if (!request.input('manage'))
      throw new Exception('Lacks probe.manage', { code: 'E_FORBIDDEN', status: 403 })
    return { gated: true }
  }

  async model() {
    return new User()
  }

  async collections() {
    return { tags: new Set(['a']), counts: new Map([['a', 1]]), total: 10n }
  }

  async search({ request }: HttpContext) {
    return request.validateUsing(searchProbeValidator)
  }

  async item({ params }: HttpContext) {
    return { id: params.id as string | undefined }
  }

  async echo({ request }: HttpContext) {
    return request.validateUsing(echoProbeValidator)
  }

  async head() {
    return {}
  }
}
