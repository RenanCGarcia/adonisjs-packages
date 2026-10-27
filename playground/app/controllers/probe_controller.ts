import { Readable } from 'node:stream'
import { fileURLToPath } from 'node:url'
import User from '#models/user'
import { manageProbe } from '#abilities/main'
import { findUser } from '#services/find_user'
import ProbePolicy from '#policies/probe_policy'
import EmailTakenException from '#exceptions/email_taken_exception'
import PlanLimitException from '#exceptions/plan_limit_exception'
import MaintenanceException from '#exceptions/maintenance_exception'
import SeatLimitException from '#exceptions/seat_limit_exception'
import { echoProbeValidator, searchProbeValidator } from '#validators/probe'
import type { HttpContext } from '@adonisjs/core/http'

const manifest = fileURLToPath(new URL('../../package.json', import.meta.url))

/**
 * What the exception handler sends when a policy denies with a status of its own.
 */
export interface HiddenProbe {
  code: 'E_AUTHORIZATION_FAILURE'
  message: string
}

/**
 * The error body of the mail provider, which the handler relays as is.
 */
export interface UpstreamError {
  code: string
  message: string
  provider: string
}

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

  async report({ response }: HttpContext) {
    response.download('resources/probe/report.pdf')
  }

  async exported({ response }: HttpContext) {
    const table = 'users'
    response.attachment(`resources/probe/${table}.csv`)
  }

  async stream({ response }: HttpContext) {
    response.stream(Readable.from(['a', 'b']))
  }

  /**
   * @response {409} The email is taken
   */
  async thrown({ request }: HttpContext) {
    if (request.input('email')) throw new EmailTakenException(request.input('email'))
    return { available: true }
  }

  /**
   * @response {403} Lacks `probe.manage`
   */
  async gated({ bouncer }: HttpContext) {
    await bouncer.authorize(manageProbe)
    return { gated: true }
  }

  /**
   * @response {403} Verify the email address first
   */
  async reasoned() {
    return 'pong'
  }

  async authorized({ bouncer }: HttpContext) {
    await bouncer.authorize(manageProbe)
    return { authorized: true }
  }

  async viewed({ bouncer }: HttpContext) {
    await bouncer.with(ProbePolicy).authorize('view')
    return { viewed: true }
  }

  /**
   * @response {404} {HiddenProbe} The probe is hidden from guests
   */
  async hidden({ bouncer }: HttpContext) {
    await bouncer.with(ProbePolicy).authorize('show')
    return { visible: true }
  }

  async found({ params }: HttpContext) {
    const user = await findUser(Number(params.id))
    return { email: user.email }
  }

  async plan({ request }: HttpContext) {
    if (request.input('probes', 0) >= 3) throw new PlanLimitException('Upgrade to add more probes')
    return { created: true }
  }

  async seats({ request }: HttpContext) {
    if (request.input('seats', 0) >= 5) throw new SeatLimitException('Upgrade to add more seats')
    return { added: true }
  }

  async maintenance({ request }: HttpContext) {
    if (!request.input('force')) throw new MaintenanceException('Back in five minutes')
    return { up: true }
  }

  /**
   * @response {502} {UpstreamError} The mail provider did not answer
   */
  async upstream({ response }: HttpContext) {
    const answer: unknown = JSON.parse(
      '{"code":"E_UPSTREAM","message":"Mail provider timed out","provider":"smtp"}',
    )
    return response.status(502).send(answer)
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
