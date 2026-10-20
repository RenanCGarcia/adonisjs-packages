import { randomUUID } from 'node:crypto'

import type { EmitterService, LoggerService } from '@adonisjs/core/types'
import type { Database } from '@adonisjs/lucid/database'
import type { TransactionClientContract } from '@adonisjs/lucid/types/database'
import { DateTime, Duration } from 'luxon'

import type { ContactIdentity, NormalizedEvent, WebhookRequest } from './adapters/port.ts'
import type { Automation, Effect } from './automations.ts'
import type { AuthorizeQuestion, ResolvedInboxConfig } from './define_config.ts'
import type { InboundMessage } from './bots.ts'
import { InboxError } from './errors.ts'
import { dispatchMessage, whereClaimable, whereInFlight } from './internal/outbox.ts'
import {
  affectedRows,
  columnsOf,
  Conflict,
  findOrCreate,
  sqlTime,
  unitOfWork,
  type Later,
} from './internal/unit_of_work.ts'
import { toContentColumns } from './message/content.ts'
import { advanceableFrom } from './message/status.ts'
import type { InboxModelOf } from './mixins/main.ts'
import {
  DISPATCH_LEASE_MS,
  retryOf,
  type BotTrigger,
  type InboxTask,
  type TaskDriver,
} from './tasks.ts'
import {
  holder,
  planChange,
  planOpening,
  questionsFor,
  type PlanContext,
  type TicketChange,
} from './ticket/plan.ts'
import { toRow } from './ticket/row.ts'
import type {
  Actor,
  ApplyResult,
  Attendant,
  AttendantId,
  BotKey,
  ChannelEventId,
  ConversationId,
  Gesture,
  HostUserId,
  IngestReceipt,
  MessageContent,
  MessageId,
  MessageStatus,
  QueueId,
  Rejection,
  SendMessageOptions,
  SendOutcome,
  TicketFact,
  TicketId,
  TicketSnapshot,
} from './types.ts'

/**
 * How many times a ticket write re-reads and re-plans after losing a race before it gives up
 * with `conflict`.
 */
const ATTEMPTS = 3

/**
 * Tickets opened and messages received from a webhook are recorded as this actor.
 */
const INGEST: Actor = { kind: 'system', source: 'ingest' }

/**
 * How many times a bot turn runs again on a batch that grew while it ran, before it commits its
 * last answer over whatever the ticket became.
 */
const BOT_RERUNS = 3

/**
 * What a plan relied on that another writer could change before the write lands.
 */
interface Reliance {
  memberships: Array<[AttendantId, QueueId]>
  activeAttendants: AttendantId[]
}

/**
 * One change, planned on the ticket as the change before it left it.
 */
interface Step {
  change: TicketChange
  actor: Actor
  from: TicketSnapshot
  next: TicketSnapshot
  facts: TicketFact[]
}

interface Planned {
  outcome: 'planned'
  /**
   * The actor as it is now, read again from its row.
   */
  actor: Actor
  next: TicketSnapshot
  steps: Step[]
  reliance: Reliance
  /**
   * Messages automations send in the write.
   */
  sends: Array<{ channel: ChannelRow; content: MessageContent }>
}

type PlanOutcome = Planned | { outcome: 'rejected'; reason: Rejection; actor: Actor }

interface TicketWrite {
  /**
   * The changes, in order, on the ticket as this attempt read it. None leaves it unchanged.
   */
  decide: (ticket: TicketSnapshot) => TicketChange[]
  /**
   * Asks `config.authorize` about this operation on every attempt.
   */
  authorizeAs?: AuthorizeQuestion['operation']
  /**
   * Run on the ticket the changes leave, so their effects land in this same write.
   */
  automations?: { list: ReadonlyArray<Automation<string>>; now: DateTime }
  /**
   * Writes over this version only, in one attempt, and comes back `conflict` once it moved.
   */
  version?: number
  /**
   * More writes that land, or roll back, with the ticket's. A ticket the change leaves unchanged
   * is still compared and swapped, so these never land on a ticket that moved.
   */
  within?: (trx: TransactionClientContract, ticket: TicketSnapshot, later: Later) => Promise<void>
}

type ChannelRow = InstanceType<InboxModelOf<'channel'>>

type BotTurnTask = Extract<InboxTask, { task: 'bot_turn' }>

type BotAttendant = Extract<Attendant, { kind: 'bot' }>

export class Inbox {
  readonly #config: ResolvedInboxConfig
  readonly #db: Database
  readonly #emitter: EmitterService
  readonly #logger: LoggerService
  readonly #tasks: TaskDriver
  #bots: Promise<ReadonlyMap<string, BotAttendant>> | undefined

  constructor(
    config: ResolvedInboxConfig,
    db: Database,
    emitter: EmitterService,
    logger: LoggerService,
  ) {
    this.#config = config
    this.#db = db
    this.#emitter = emitter
    this.#logger = logger
    this.#tasks = config.tasks(task => this.run(task))
  }

  /**
   * Drops the tasks still waiting to run in this process. The provider calls it on shutdown.
   */
  close() {
    this.#tasks.close()
  }

  readonly tickets = {
    /**
     * Every ticket transition. It reads the ticket, plans the gesture and writes it with a
     * compare-and-swap on `version`. When the ticket moved in between, it reads and plans again,
     * up to three times, running `authorize` and the membership rule against each fresh read.
     */
    apply: (id: TicketId, gesture: Gesture, actor: Actor): Promise<ApplyResult> =>
      this.#write(id, actor, { decide: () => [gesture], authorizeAs: gesture }),

    /**
     * Zeroes the unread count when `attendant` holds the ticket, and does nothing otherwise.
     */
    markRead: async (id: TicketId, attendant: Attendant) => {
      const Ticket = await this.#config.model('ticket')

      await Ticket.query()
        .where('id', id)
        .where('assigneeId', attendant.id)
        .where('status', 'in_progress')
        .where('unreadCount', '>', 0)
        .update({ unreadCount: 0 })
        .increment('version', 1)
    },

    /**
     * Opens a queued ticket in the conversation, or returns the one already open there. A unique
     * index on the open conversation decides between two concurrent openings.
     */
    open: (conversationId: ConversationId, queueId: QueueId, actor: Actor) =>
      this.#open(conversationId, queueId, actor, 'outbound'),
  }

  readonly messages = {
    /**
     * Replies on the ticket. The reply goes through the same compare-and-swap as a gesture, so a
     * human replying to a queued ticket, or to one a bot holds, assumes it in the same write, and
     * a reply to a ticket another human holds is rejected. The message is stored pending in that
     * write and dispatched after the commit. A retry with the same `clientRef` returns the message
     * the first call stored. Content of a kind the channel's adapter can't send is rejected
     * before anything is written.
     */
    send: async (
      id: TicketId,
      content: MessageContent,
      author: Attendant,
      options: SendMessageOptions = {},
    ): Promise<SendOutcome> => {
      const Message = await this.#config.model('message')
      const clientRef = options.clientRef ?? randomUUID()
      const stored = () => Message.findBy('clientRef', clientRef)
      const replayed = options.clientRef === undefined ? null : await stored()

      if (replayed !== null) return this.#queued(id, replayed.id)

      const Ticket = await this.#config.model('ticket')
      // A ticket never changes conversation, so its channel can be read outside the write.
      const channel = await this.#channelOf((await Ticket.findOrFail(id)).conversationId)

      if (!this.#config.adapters.canSend(channel.provider, content.kind)) {
        return { outcome: 'rejected', reason: 'unsupported_content' }
      }

      const now = DateTime.now()
      let result: ApplyResult

      try {
        result = await this.#write(id, author, {
          decide: () => [{ gesture: 'reply', at: now }],
          authorizeAs: { gesture: 'send' },
          within: (trx, ticket, later) =>
            this.#storePending(
              trx,
              ticket,
              channel,
              { content, authorId: author.id, clientRef },
              later,
            ),
        })
      } catch (error) {
        const winner = await stored()

        if (winner !== null) return this.#queued(id, winner.id)

        throw error
      }

      if (result.outcome === 'rejected') return result

      const row = await Message.findByOrFail('clientRef', clientRef)

      return { outcome: 'queued', messageId: row.id, ticket: result.ticket }
    },
  }

  readonly attendants = {
    /**
     * The attendant row of a host user, created on first use.
     */
    forUser: async (userId: HostUserId) => {
      const Attendant = await this.#config.model('attendant')

      const row = await findOrCreate(
        () => Attendant.findBy('userId', userId),
        () => Attendant.create({ kind: 'human', userId }),
      )

      return row.asAttendant
    },

    /**
     * The attendant row of a bot from `config.bots`, created on first use.
     */
    bot: (key: BotKey): Promise<Attendant> => this.#botAttendant(key),

    /**
     * Marks the attendant inactive and returns every ticket it holds to its queue. An assume
     * racing it either commits first, and is released here, or fails against it.
     */
    deactivate: async (attendant: Attendant) => {
      const Attendant = await this.#config.model('attendant')
      const row = await Attendant.findOrFail(attendant.id)

      if (row.deactivatedAt === null) {
        row.deactivatedAt = DateTime.now()
        await row.save()
      }

      await this.#release(attendant.id, null, 'attendant_deactivated')
    },
  }

  readonly queues = {
    addMember: async (queueId: QueueId, attendant: Attendant) => {
      const QueueMember = await this.#config.model('queueMember')

      await findOrCreate(
        () =>
          QueueMember.query().where('queueId', queueId).where('attendantId', attendant.id).first(),
        () => QueueMember.create({ queueId, attendantId: attendant.id }),
      )
    },

    /**
     * Removes the membership and returns the tickets the attendant holds in that queue.
     */
    removeMember: async (queueId: QueueId, attendant: Attendant) => {
      const QueueMember = await this.#config.model('queueMember')

      const membership = await QueueMember.query()
        .where('queueId', queueId)
        .where('attendantId', attendant.id)
        .first()

      await membership?.delete()
      await this.#release(attendant.id, queueId, 'member_removed')
    },
  }

  /**
   * The webhook entry. Finds the channel by its token, has its adapter verify the request, stores
   * the body as it came and queues the ingest. Parsing waits for the task, so the provider gets
   * its answer right away.
   */
  async ingest(token: string, request: WebhookRequest): Promise<IngestReceipt> {
    const Channel = await this.#config.model('channel')

    const channel = await Channel.query()
      .where('webhookToken', token)
      .whereNull('archivedAt')
      .first()

    if (channel === null) return 'unknown_channel'

    const adapter = this.#config.adapters.get(channel.provider)

    if (!adapter.verify({ id: channel.id, credentials: channel.credentials }, request)) {
      return 'invalid_signature'
    }

    const ChannelEvent = await this.#config.model('channelEvent')

    const event = await ChannelEvent.create({
      channelId: channel.id,
      rawBody: request.rawBody,
      receivedAt: DateTime.now(),
    })

    await this.#enqueue({ task: 'ingest', channelEventId: event.id, attempt: 0 })

    return 'accepted'
  }

  /**
   * Queues again the work a lost task left behind, such as after a restart. That is stored
   * webhooks never ingested and pending messages no dispatch owns, each older than a dispatch
   * lease so the task that made it had its chance. Run it periodically.
   */
  async recover() {
    const ChannelEvent = await this.#config.model('channelEvent')
    const Message = await this.#config.model('message')
    const now = DateTime.now()
    const stale = sqlTime(Message, now.minus({ milliseconds: DISPATCH_LEASE_MS }))

    const events = await ChannelEvent.query()
      .whereNull('processedAt')
      .where('receivedAt', '<', stale)
      .select('id')

    const messages = await Message.query()
      .where(whereClaimable(Message, now))
      .where('sentAt', '<', stale)
      .select('id')

    for (const { id } of events) {
      await this.#enqueue({ task: 'ingest', channelEventId: id, attempt: 0 })
    }

    for (const { id } of messages) {
      await this.#enqueue({ task: 'dispatch', messageId: id, attempt: 0 })
    }
  }

  /**
   * Runs a task a driver handed back, and queues its retry when it fails. A `tasks.queue()` job
   * calls it with its payload.
   */
  async run(task: InboxTask) {
    try {
      switch (task.task) {
        case 'ingest':
          return await this.#ingestEvent(task.channelEventId)
        case 'dispatch':
          return await dispatchMessage(this.#config, this.#announce, task.messageId)
        case 'bot_turn':
          return await this.#botTurn(task)
        default: {
          const unhandled: never = task

          return unhandled
        }
      }
    } catch (error) {
      const retry = retryOf(task)

      if (retry === null) {
        this.#logger.error({ err: error, task }, 'inbox: a task failed on its last attempt')

        return
      }

      await this.#tasks.enqueue(retry.task, retry.delayMs)
    }
  }

  async #open(
    conversationId: ConversationId,
    queueId: QueueId,
    actor: Actor,
    origin: 'inbound' | 'outbound',
  ) {
    const Ticket = await this.#config.model('ticket')
    const openIn = () => Ticket.query().where('openConversationId', conversationId).first()
    const existing = await openIn()

    if (existing !== null) return { opened: false, ticket: existing.snapshot }

    const Conversation = await this.#config.model('conversation')
    const Channel = await this.#config.model('channel')
    const conversation = await Conversation.findOrFail(conversationId)
    const channel = await Channel.findOrFail(conversation.channelId)
    const opening = planOpening(queueId, origin)
    const automations = this.#automationsOn('ticket_opened')
    const bots = automations.length === 0 ? new Map() : await this.#botDirectory()
    const now = DateTime.now()

    try {
      return await unitOfWork(this.#db, async (trx, later) => {
        const row = await Ticket.create(
          {
            ...this.#config.ownership(channel),
            ...toRow({
              conversationId,
              version: 0,
              state: opening.state,
              openedAt: now,
              assignedAt: null,
              firstResponseAt: null,
              lastActivityAt: now,
              closedAt: null,
              unreadCount: 0,
              botState: {},
            }),
          },
          { client: trx },
        )

        await this.#record(trx, row.id, opening.facts, actor, undefined)

        later(() =>
          this.#emit(() =>
            this.#emitter.emit('inbox:ticket_opened', {
              ticketId: row.id,
              conversationId,
              queueId,
            }),
          ),
        )

        const opened = row.snapshot

        const planned = await this.#automate(unplanned(opened, actor), automations, {
          channel,
          now,
          bots,
          client: trx,
        })

        if (planned.steps.length > 0 || planned.sends.length > 0) {
          await this.#commit(trx, row, planned, later)
        }

        // The inbound message that opened it follows, and its turn answers it.
        if (origin === 'outbound') this.#turnOnHandover(opened, planned.next, actor, later)

        return { opened: true, ticket: planned.next }
      })
    } catch (error) {
      const winner = await openIn()

      if (winner !== null) return { opened: false, ticket: winner.snapshot }

      throw error
    }
  }

  async #write(id: TicketId, actor: Actor, write: TicketWrite): Promise<ApplyResult> {
    const Ticket = await this.#config.model('ticket')
    const automations = write.automations?.list ?? []
    let channel: ChannelRow | undefined

    for (let attempt = 0; attempt < (write.version === undefined ? ATTEMPTS : 1); attempt++) {
      const row = await Ticket.findOrFail(id)
      const ticket = row.snapshot

      if (write.version !== undefined && ticket.version !== write.version) break

      const changes = write.decide(ticket)

      if (changes.length === 0 && automations.length === 0) return { outcome: 'unchanged', ticket }

      const plan = await this.#plan(ticket, actor, changes)

      const allowed =
        write.authorizeAs === undefined ||
        (await this.#config.authorize({ actor: plan.actor, operation: write.authorizeAs, ticket }))

      if (!allowed) return { outcome: 'rejected', reason: 'forbidden' }

      if (plan.outcome === 'rejected') return { outcome: 'rejected', reason: plan.reason }

      let planned = plan

      if (write.automations !== undefined && automations.length > 0) {
        channel ??= await this.#channelOf(ticket.conversationId)

        planned = await this.#automate(plan, automations, {
          channel,
          now: write.automations.now,
          bots: await this.#botDirectory(),
        })
      }

      if (planned.steps.length === 0 && planned.sends.length === 0 && write.within === undefined) {
        return { outcome: 'unchanged', ticket }
      }

      try {
        await unitOfWork(this.#db, async (trx, later) => {
          await this.#commit(trx, row, planned, later)
          await write.within?.(trx, planned.next, later)

          // An inbound message schedules its own turn, which answers it.
          if (!planned.steps.some(step => step.change.gesture === 'inbound')) {
            this.#turnOnHandover(ticket, planned.next, actor, later)
          }
        })

        return planned.steps.length > 0
          ? {
              outcome: 'changed',
              ticket: planned.next,
              facts: planned.steps.flatMap(step => step.facts),
            }
          : { outcome: 'unchanged', ticket }
      } catch (error) {
        if (!(error instanceof Conflict)) throw error
      }
    }

    return { outcome: 'rejected', reason: 'conflict' }
  }

  /**
   * Plans `changes` in order, each on the ticket the one before it left, reading for each what
   * `plan` can't read itself. A rejected change rejects them all.
   */
  async #plan(
    ticket: TicketSnapshot,
    actor: Actor,
    changes: TicketChange[],
    client?: TransactionClientContract,
  ): Promise<PlanOutcome> {
    const planned = unplanned(ticket, actor)

    for (const change of changes) {
      const { context, current, reliance } = await this.#contextFor(
        planned.next,
        change,
        actor,
        client,
      )

      const step = planChange(planned.next, change, current, context)

      planned.actor = current

      if (step.outcome === 'rejected') {
        return { outcome: 'rejected', reason: step.reason, actor: current }
      }

      planned.reliance.memberships.push(...reliance.memberships)
      planned.reliance.activeAttendants.push(...reliance.activeAttendants)

      if (step.outcome === 'unchanged') continue

      planned.steps.push({
        change,
        actor: current,
        from: planned.next,
        next: step.next,
        facts: step.facts,
      })
      planned.next = step.next
    }

    return planned
  }

  /**
   * Adds the effects of each automation, decided on the ticket the plan so far leaves. An
   * automation whose effects the state machine rejects is skipped, and the rest still apply.
   */
  async #automate(
    planned: Planned,
    automations: ReadonlyArray<Automation<string>>,
    moment: {
      channel: ChannelRow
      now: DateTime
      bots: ReadonlyMap<string, BotAttendant>
      client?: TransactionClientContract
    },
  ): Promise<Planned> {
    const { channel, now, bots, client } = moment

    const result: Planned = {
      ...planned,
      steps: [...planned.steps],
      reliance: {
        memberships: [...planned.reliance.memberships],
        activeAttendants: [...planned.reliance.activeAttendants],
      },
      sends: [...planned.sends],
    }

    for (const automation of automations) {
      const effects = automation.decide({
        ticket: result.next,
        channel: { id: channel.id, provider: channel.provider },
        now,
      })

      if (effects.length === 0) continue

      const changes = effects.flatMap(effect => changeOf(effect, bots, automation.name))
      const contents = effects.flatMap(effect => (effect.effect === 'send' ? [effect.content] : []))

      const sendable = contents.filter(({ kind }) =>
        this.#config.adapters.canSend(channel.provider, kind),
      )

      if (sendable.length < contents.length) {
        this.#logger.warn(
          { automation: automation.name, provider: channel.provider },
          'inbox: an automation sent content its channel cannot send',
        )
      }

      const system: Actor = { kind: 'system', source: automation.name }
      const plan = await this.#plan(result.next, system, changes, client)

      if (plan.outcome === 'rejected') {
        this.#logger.warn(
          { automation: automation.name, ticketId: result.next.id, reason: plan.reason },
          'inbox: an automation was rejected, so it was skipped',
        )

        continue
      }

      result.next = plan.next
      result.steps.push(...plan.steps)
      result.reliance.memberships.push(...plan.reliance.memberships)
      result.reliance.activeAttendants.push(...plan.reliance.activeAttendants)
      result.sends.push(...sendable.map(content => ({ channel, content })))
    }

    return result
  }

  /**
   * Swaps the ticket from the version `row` was read at to the planned one, and records and
   * announces each step. A plan with no steps still swaps, so what lands with it never lands on a
   * ticket that moved.
   */
  async #commit(
    trx: TransactionClientContract,
    row: InstanceType<InboxModelOf<'ticket'>>,
    planned: Planned,
    later: Later,
  ) {
    await this.#compareAndSwap(trx, row, planned.next)
    await this.#reassert(trx, planned.reliance)

    for (const step of planned.steps) {
      const { change, from, next, facts } = step

      await this.#record(trx, row.id, facts, step.actor, 'note' in change ? change.note : undefined)

      const name = change.gesture

      if (name === 'inbound' || name === 'bot_state') continue

      later(() =>
        this.#emit(() =>
          this.#emitter.emit('inbox:ticket_changed', {
            ticketId: row.id,
            change: name,
            from: from.state,
            to: next.state,
            facts,
          }),
        ),
      )
    }

    for (const { channel, content } of planned.sends) {
      await this.#storePending(trx, planned.next, channel, { content, authorId: null }, later)
    }
  }

  /**
   * Stores an outgoing message pending in the write, and dispatches it after the commit.
   */
  async #storePending(
    trx: TransactionClientContract,
    ticket: TicketSnapshot,
    channel: ChannelRow,
    message: { content: MessageContent; authorId: AttendantId | null; clientRef?: string },
    later: Later,
  ) {
    const Message = await this.#config.model('message')

    const row = await Message.create(
      {
        ...this.#config.ownership(channel),
        conversationId: ticket.conversationId,
        ticketId: ticket.id,
        direction: 'outbound',
        ...toContentColumns(message.content),
        status: 'pending',
        authorId: message.authorId,
        clientRef: message.clientRef ?? randomUUID(),
        sentAt: DateTime.now(),
      },
      { client: trx },
    )

    later(() => this.#enqueue({ task: 'dispatch', messageId: row.id, attempt: 0 }))
  }

  /**
   * Reads what `plan` can't: the actor and the target as they are now, and the memberships
   * `questionsFor` names.
   */
  async #contextFor(
    ticket: TicketSnapshot,
    change: TicketChange,
    actor: Actor,
    client?: TransactionClientContract,
  ) {
    const Attendant = await this.#config.model('attendant')
    const QueueMember = await this.#config.model('queueMember')

    const targetId =
      change.gesture === 'assign' || change.gesture === 'transfer' ? change.to : undefined

    const ids = [actor.kind === 'system' ? undefined : actor.id, targetId].filter(
      (attendantId): attendantId is AttendantId => attendantId !== undefined,
    )

    const rows = ids.length === 0 ? [] : await Attendant.query({ client }).whereIn('id', ids)
    const attendants = new Map(rows.map(row => [row.id, row.asAttendant]))

    // A vanished attendant can't hold a ticket, which is what inactive means to `plan`.
    const current: Actor =
      actor.kind === 'system' ? actor : (attendants.get(actor.id) ?? { ...actor, active: false })

    const target = targetId === undefined ? undefined : attendants.get(targetId)
    const questions = questionsFor(ticket, change, current)

    const members =
      questions.length === 0
        ? []
        : await QueueMember.query({ client }).where(query => {
            for (const [attendantId, queueId] of questions) {
              query.orWhere(pair =>
                pair.where('attendantId', attendantId).where('queueId', queueId),
              )
            }
          })

    const memberOf = new Set(members.map(member => `${member.attendantId}:${member.queueId}`))

    const context: PlanContext = {
      now: DateTime.now(),
      isMember: (attendantId, queueId) => memberOf.has(`${attendantId}:${queueId}`),
      target:
        target === undefined
          ? undefined
          : { kind: target.kind, id: target.id, active: target.active },
    }

    const reliance: Reliance = {
      memberships: questions.filter(([attendantId, queueId]) =>
        memberOf.has(`${attendantId}:${queueId}`),
      ),
      activeAttendants: [current, target].flatMap(attendant =>
        attendant !== undefined && attendant.kind !== 'system' && attendant.active
          ? [attendant.id]
          : [],
      ),
    }

    return { context, current, reliance }
  }

  async #compareAndSwap(
    trx: TransactionClientContract,
    row: InstanceType<InboxModelOf<'ticket'>>,
    next: TicketSnapshot,
  ) {
    const Ticket = await this.#config.model('ticket')

    const updated = await Ticket.query({ client: trx })
      .where('id', next.id)
      .where('version', row.version)
      .update(columnsOf(Ticket, row, toRow(next)))

    if (affectedRows(updated) === 0) throw new Conflict()
  }

  /**
   * Writes each row the plan relied on back unchanged, so the write waits on, or fails against,
   * a concurrent removal of that membership or deactivation of that attendant. Without it an
   * attendant could be handed a ticket in a queue it was just removed from.
   */
  async #reassert(trx: TransactionClientContract, reliance: Reliance) {
    const QueueMember = await this.#config.model('queueMember')
    const Attendant = await this.#config.model('attendant')

    for (const [attendantId, queueId] of reliance.memberships) {
      const touched = await QueueMember.query({ client: trx })
        .where('attendantId', attendantId)
        .where('queueId', queueId)
        .update({ attendantId })

      if (affectedRows(touched) === 0) throw new Conflict()
    }

    for (const attendantId of reliance.activeAttendants) {
      const touched = await Attendant.query({ client: trx })
        .where('id', attendantId)
        .whereNull('deactivatedAt')
        .update({ deactivatedAt: null })

      if (affectedRows(touched) === 0) throw new Conflict()
    }
  }

  async #record(
    trx: TransactionClientContract,
    ticketId: TicketId,
    facts: TicketFact[],
    actor: Actor,
    note: string | undefined,
  ) {
    if (facts.length === 0) return

    const TicketEvent = await this.#config.model('ticketEvent')

    await TicketEvent.createMany(
      facts.map(fact => ({
        ticketId,
        type: fact.fact,
        data: fact,
        actorKind: actor.kind,
        actorId: actor.kind === 'system' ? null : actor.id,
        actorSource: actor.kind === 'system' ? actor.source : null,
        note: note ?? null,
      })),
      { client: trx },
    )
  }

  /**
   * Hands every ticket `attendantId` holds, in `queueId` or anywhere, back to its queue. Each
   * ticket is decided again on every read, so one that changed hands meanwhile is left alone.
   */
  async #release(attendantId: AttendantId, queueId: QueueId | null, source: string) {
    const Ticket = await this.#config.model('ticket')
    const query = Ticket.query().where('assigneeId', attendantId).where('status', 'in_progress')
    const held = await (queueId === null ? query : query.where('queueId', queueId))

    for (const { id } of held) {
      await this.#write(
        id,
        { kind: 'system', source },
        {
          decide: ticket => {
            const current = holder(ticket.state)

            const stillHeld =
              current?.id === attendantId && (queueId === null || ticket.state.queueId === queueId)

            return stillHeld ? [{ gesture: 'return' }] : []
          },
        },
      )
    }
  }

  /**
   * Applies each event of a stored webhook in its own transaction, then marks it processed.
   * Every event converges when applied again, so a retry after a failure replays the whole body.
   */
  async #ingestEvent(id: ChannelEventId) {
    const ChannelEvent = await this.#config.model('channelEvent')
    const event = await ChannelEvent.find(id)

    if (event === null || event.processedAt !== null) return

    const Channel = await this.#config.model('channel')
    const channel = await Channel.findOrFail(event.channelId)
    const failures: unknown[] = []

    for (const normalized of this.#config.adapters.eventsOf(channel.provider, event.rawBody)) {
      try {
        await this.#applyEvent(channel, normalized)
      } catch (error) {
        failures.push(error)
      }
    }

    if (failures.length > 0) {
      throw new AggregateError(failures, `inbox: channel event ${id} has events left to apply`)
    }

    await ChannelEvent.query()
      .where('id', id)
      .whereNull('processedAt')
      .update({ processedAt: sqlTime(ChannelEvent, DateTime.now()) })
  }

  async #applyEvent(channel: ChannelRow, event: NormalizedEvent) {
    switch (event.type) {
      case 'message_received':
        return this.#receive(channel, event)
      case 'message_echoed':
        return this.#echo(channel, event)
      case 'message_status_changed':
        return this.#changeStatus(channel, event)
      case 'unsupported':
        return
      default: {
        const unhandled: never = event

        return unhandled
      }
    }
  }

  /**
   * Stores an inbound message on the conversation's open ticket, opening one in the channel's
   * queue when there is none. The message and the ticket's unread bump land in one
   * compare-and-swap, and the unique `(conversation_id, external_id)` makes a duplicate roll
   * both back.
   */
  async #receive(
    channel: ChannelRow,
    event: Extract<NormalizedEvent, { type: 'message_received' }>,
  ) {
    const conversation = await this.#conversationOf(channel, event.from, event.profileName)
    const stored = () => this.#storedMessage(conversation.id, event.externalId)

    if ((await stored()) !== null) return

    const Message = await this.#config.model('message')

    for (let attempt = 0; attempt < ATTEMPTS; attempt++) {
      const { ticket } = await this.#open(
        conversation.id,
        channel.defaultQueueId,
        INGEST,
        'inbound',
      )

      let result: ApplyResult

      try {
        result = await this.#write(ticket.id, INGEST, {
          decide: () => [{ gesture: 'inbound', sentAt: event.sentAt }],
          automations: { list: this.#automationsOn('message_received'), now: DateTime.now() },
          within: async (trx, current, later) => {
            const message = await Message.create(
              {
                ...this.#config.ownership(channel),
                conversationId: conversation.id,
                ticketId: current.id,
                direction: 'inbound',
                ...toContentColumns(event.content),
                status: null,
                externalId: event.externalId,
                sentAt: event.sentAt,
              },
              { client: trx },
            )

            later(() =>
              this.#emit(() =>
                this.#emitter.emit('inbox:message_received', {
                  messageId: message.id,
                  ticketId: current.id,
                  conversationId: conversation.id,
                }),
              ),
            )

            const bot = holder(current.state)

            if (bot?.kind === 'bot') {
              later(() =>
                this.#enqueueTurn(current.id, bot.id, { kind: 'message', messageId: message.id }),
              )
            }
          },
        })
      } catch (error) {
        if ((await stored()) !== null) return

        throw error
      }

      // A ticket closed since it was read is left closed, and the next attempt opens a new one.
      if (result.outcome !== 'rejected') return

      if (result.reason !== 'closed') break
    }

    throw new Error(`inbox: inbound message ${event.externalId} found no ticket to land on`)
  }

  /**
   * A message the channel sent outside the inbox, from the phone itself. One with the id of our
   * own send is already stored. While one of our sends is in flight in the conversation, the echo
   * may be its answer, so it waits for the send to settle.
   */
  async #echo(channel: ChannelRow, event: Extract<NormalizedEvent, { type: 'message_echoed' }>) {
    const conversation = await this.#conversationOf(channel, event.to)
    const stored = () => this.#storedMessage(conversation.id, event.externalId)

    if ((await stored()) !== null) return

    const Message = await this.#config.model('message')

    const inFlight = await Message.query()
      .where('conversationId', conversation.id)
      .where(whereInFlight(Message, DateTime.now()))
      .first()

    if (inFlight !== null) {
      throw new Error(`inbox: echo ${event.externalId} waits for message ${inFlight.id} to settle`)
    }

    const Ticket = await this.#config.model('ticket')
    const open = await Ticket.query().where('openConversationId', conversation.id).first()

    await findOrCreate(stored, () =>
      Message.create({
        ...this.#config.ownership(channel),
        conversationId: conversation.id,
        ticketId: open?.id ?? null,
        direction: 'outbound',
        ...toContentColumns(event.content),
        status: 'sent',
        externalId: event.externalId,
        sentAt: event.sentAt,
      }),
    )
  }

  /**
   * Moves an outgoing message's status forward only, so a repeated or reordered webhook is a
   * no-op. A status for a send whose outcome was unknown finds it by `clientRef` and settles it.
   */
  async #changeStatus(
    channel: ChannelRow,
    event: Extract<NormalizedEvent, { type: 'message_status_changed' }>,
  ) {
    const Message = await this.#config.model('message')
    const Conversation = await this.#config.model('conversation')
    const failureCode = event.status === 'failed' ? (event.error ?? 'unknown') : null

    const sent = () =>
      Message.query()
        .where('direction', 'outbound')
        .whereIn('conversationId', Conversation.query().select('id').where('channelId', channel.id))

    const known = await sent().where('externalId', event.externalId).first()

    if (known !== null) {
      const updated = await Message.query()
        .where('id', known.id)
        .whereIn('status', advanceableFrom(event.status))
        .update(
          failureCode === null ? { status: event.status } : { status: event.status, failureCode },
        )

      if (affectedRows(updated) > 0) await this.#announce(known.id, event.status)

      return
    }

    const unsettled =
      event.clientRef === undefined
        ? null
        : await sent().where('clientRef', event.clientRef).whereNull('externalId').first()

    if (unsettled !== null) {
      const updated = await Message.query()
        .where('id', unsettled.id)
        .whereNull('externalId')
        .where(open =>
          open
            .whereIn('status', advanceableFrom(event.status))
            .orWhere('failureCode', 'outcome_unknown'),
        )
        .update({ status: event.status, externalId: event.externalId, failureCode })

      if (affectedRows(updated) > 0) await this.#announce(unsettled.id, event.status)

      return
    }

    const inFlight = await sent().where(whereInFlight(Message, DateTime.now())).first()

    if (inFlight !== null) {
      throw new Error(
        `inbox: status of ${event.externalId} waits for message ${inFlight.id} to settle`,
      )
    }
  }

  /**
   * The contact and conversation behind an address on this channel, created on first contact.
   */
  async #conversationOf(channel: ChannelRow, identity: ContactIdentity, name?: string) {
    const Contact = await this.#config.model('contact')
    const Conversation = await this.#config.model('conversation')
    const address = this.#config.contactKey(identity.address, channel.provider)
    const owned = this.#config.ownership(channel)

    const contact = await findOrCreate(
      () => Contact.query().where('channelId', channel.id).where('address', address).first(),
      () => Contact.create({ ...owned, channelId: channel.id, address, name: name ?? null }),
    )

    return findOrCreate(
      () =>
        Conversation.query().where('channelId', channel.id).where('contactId', contact.id).first(),
      () => Conversation.create({ ...owned, channelId: channel.id, contactId: contact.id }),
    )
  }

  async #storedMessage(conversationId: ConversationId, externalId: string) {
    const Message = await this.#config.model('message')

    return Message.query()
      .where('conversationId', conversationId)
      .where('externalId', externalId)
      .first()
  }

  async #channelOf(conversationId: ConversationId) {
    const Conversation = await this.#config.model('conversation')
    const Channel = await this.#config.model('channel')
    const conversation = await Conversation.findOrFail(conversationId)

    return Channel.findOrFail(conversation.channelId)
  }

  async #queued(id: TicketId, messageId: MessageId): Promise<SendOutcome> {
    const Ticket = await this.#config.model('ticket')
    const ticket = await Ticket.findOrFail(id)

    return { outcome: 'queued', messageId, ticket: ticket.snapshot }
  }

  /**
   * The attendant row of a bot from `config.bots`, created on first use.
   */
  async #botAttendant(key: string): Promise<BotAttendant> {
    if (!this.#config.bots.has(key)) {
      throw new InboxError('E_INBOX_UNKNOWN_BOT', `inbox: "${key}" is not in config.bots`)
    }

    const Attendant = await this.#config.model('attendant')

    const row = await findOrCreate(
      () => Attendant.findBy('botKey', key),
      () => Attendant.create({ kind: 'bot', botKey: key }),
    )

    const attendant = row.asAttendant

    if (attendant.kind !== 'bot') {
      throw new InboxError(
        'E_INBOX_INVALID_ROW',
        `inbox: attendant ${row.id} has a bot key but is not a bot`,
      )
    }

    return attendant
  }

  /**
   * Every configured bot's attendant, by key. Read before a transaction that may assign one,
   * since creating a row outside it would wait on the transaction's own lock.
   */
  #botDirectory() {
    this.#bots ??= (async () => {
      const directory = new Map<string, BotAttendant>()

      for (const key of this.#config.bots.keys()) {
        directory.set(key, await this.#botAttendant(key))
      }

      return directory
    })().catch(error => {
      this.#bots = undefined
      throw error
    })

    return this.#bots
  }

  async #botOf(botId: AttendantId) {
    for (const [key, attendant] of await this.#botDirectory()) {
      const make = this.#config.bots.get(key)

      if (attendant.id === botId && make !== undefined) return { attendant, bot: await make() }
    }

    return null
  }

  #automationsOn(trigger: 'ticket_opened' | 'message_received') {
    return this.#config.automations.filter(automation => automation.on === trigger)
  }

  /**
   * Runs a turn for the bot a write handed the ticket to. A bot that hands it to another bot
   * leaves that one to the next message, so two bots never pass a ticket back and forth.
   */
  #turnOnHandover(from: TicketSnapshot, to: TicketSnapshot, actor: Actor, later: Later) {
    const bot = holder(to.state)

    if (bot?.kind !== 'bot' || actor.kind === 'bot' || holder(from.state)?.id === bot.id) return

    later(() => this.#enqueueTurn(to.id, bot.id, { kind: 'assigned', version: to.version }))
  }

  async #enqueueTurn(ticketId: TicketId, botId: AttendantId, trigger: BotTrigger) {
    const found = await this.#botOf(botId)

    if (found === null) return

    const debounce = trigger.kind === 'assigned' ? 0 : (found.bot.debounce ?? 0)

    await this.#tasks.enqueue(
      { task: 'bot_turn', ticketId, botId, trigger, attempt: 0 },
      Duration.fromDurationLike(debounce).toMillis(),
    )
  }

  /**
   * Reads the ticket and its unanswered messages, asks the bot outside any transaction, and
   * commits the answer guarded by the version it read. A turn whose bot lost the ticket meanwhile
   * is dropped. One whose batch grew runs again, and after `BOT_RERUNS` commits over the latest
   * version. Once committed it never runs again, so its replies go out at most once.
   */
  async #botTurn(task: BotTurnTask) {
    const found = await this.#botOf(task.botId)

    if (found === null) return

    const { attendant, bot } = found
    const Ticket = await this.#config.model('ticket')
    let channel: ChannelRow | undefined
    let committed = false

    try {
      for (let run = 0; run <= BOT_RERUNS; run++) {
        const ticket = (await Ticket.findOrFail(task.ticketId)).snapshot

        if (holder(ticket.state)?.id !== attendant.id) return

        const unanswered = await this.#unanswered(ticket.id)

        if (run === 0 && !this.#turnIsDue(task.trigger, ticket, unanswered)) return

        const stored = ticket.botState[attendant.id]
        const now = DateTime.now()

        const reply = await bot.turn({
          trigger: task.trigger.kind,
          ticket,
          unanswered,
          state: stored === undefined ? bot.initialState() : stored,
          now,
        })

        if (reply.kind === 'wait') {
          return await this.#retry(task, Duration.fromDurationLike(reply.retryIn).toMillis())
        }

        channel ??= await this.#channelOf(ticket.conversationId)

        const { provider } = channel
        const messages = reply.kind === 'reply' ? reply.messages : []

        const sendable = messages.filter(({ kind }) =>
          this.#config.adapters.canSend(provider, kind),
        )

        if (sendable.length < messages.length) {
          this.#logger.warn(
            { task, provider },
            'inbox: a bot replied with content its channel cannot send',
          )
        }

        const changes: TicketChange[] = [{ gesture: 'bot_state', state: reply.state }]

        if (sendable.length > 0) changes.push({ gesture: 'reply', at: now })

        if (reply.kind === 'reply' && reply.handoff !== undefined) changes.push(reply.handoff)

        const replyChannel = channel

        const result = await this.#write(ticket.id, attendant, {
          version: run < BOT_RERUNS ? ticket.version : undefined,
          decide: () => changes,
          within: async (trx, next, later) => {
            later(async () => {
              committed = true
            })

            for (const content of sendable) {
              await this.#storePending(
                trx,
                next,
                replyChannel,
                { content, authorId: attendant.id },
                later,
              )
            }
          },
        })

        if (result.outcome !== 'rejected') return

        if (result.reason !== 'conflict') {
          this.#logger.info(
            { task, reason: result.reason },
            'inbox: a bot turn was rejected, so it was dropped',
          )

          return
        }
      }

      this.#logger.warn({ task }, 'inbox: a bot turn kept conflicting, so it was dropped')
    } catch (error) {
      if (!committed) throw error

      this.#logger.error({ err: error, task }, 'inbox: a bot turn failed after it committed')
    }
  }

  /**
   * Whether a turn still has something to do when it starts. A turn running again because its
   * batch grew doesn't ask, since it is the one answering that batch.
   */
  #turnIsDue(trigger: BotTrigger, ticket: TicketSnapshot, unanswered: InboundMessage[]) {
    switch (trigger.kind) {
      case 'assigned':
        return ticket.version === trigger.version
      case 'message':
        // A newer message's own turn takes the batch once its debounce passes.
        return unanswered.at(-1)?.id === trigger.messageId
      default: {
        const unhandled: never = trigger

        return unhandled
      }
    }
  }

  /**
   * The inbound messages after the ticket's last reply by an attendant, oldest first.
   */
  async #unanswered(ticketId: TicketId): Promise<InboundMessage[]> {
    const Message = await this.#config.model('message')

    const answered = await Message.query()
      .where('ticketId', ticketId)
      .where('direction', 'outbound')
      .whereNotNull('authorId')
      .orderBy('id', 'desc')
      .first()

    const rows = await Message.query()
      .where('ticketId', ticketId)
      .where('direction', 'inbound')
      .where('id', '>', answered?.id ?? 0)
      .orderBy('id', 'asc')

    return rows.map(row => ({ id: row.id, content: row.content, sentAt: row.sentAt }))
  }

  async #retry(task: InboxTask, delayMs: number) {
    const retry = retryOf(task)

    if (retry === null) {
      this.#logger.warn({ task }, 'inbox: a task ran out of attempts')

      return
    }

    await this.#tasks.enqueue(retry.task, delayMs)
  }

  #enqueue(task: InboxTask) {
    return this.#tasks.enqueue(task, 0)
  }

  readonly #announce = (messageId: MessageId, status: MessageStatus) =>
    this.#emit(() => this.#emitter.emit('inbox:message_status_changed', { messageId, status }))

  /**
   * The write already committed, so a failing listener is logged instead of failing the caller.
   */
  async #emit(emit: () => Promise<void>) {
    try {
      await emit()
    } catch (error) {
      this.#logger.error({ err: error }, 'inbox: an event listener failed')
    }
  }
}

function unplanned(ticket: TicketSnapshot, actor: Actor): Planned {
  return {
    outcome: 'planned',
    actor,
    next: ticket,
    steps: [],
    reliance: { memberships: [], activeAttendants: [] },
    sends: [],
  }
}

/**
 * The ticket change an effect makes. A send changes no ticket.
 */
function changeOf(
  effect: Effect<string>,
  bots: ReadonlyMap<string, BotAttendant>,
  automation: string,
): TicketChange[] {
  switch (effect.effect) {
    case 'apply':
      return [effect.gesture]
    case 'assign_bot': {
      const bot = bots.get(effect.bot)

      if (bot === undefined) {
        throw new InboxError(
          'E_INBOX_UNKNOWN_BOT',
          `inbox: automation ${automation} assigns "${effect.bot}", which is not in config.bots`,
        )
      }

      return [{ gesture: 'assign', to: bot.id }]
    }

    case 'send':
      return []
    default: {
      const unhandled: never = effect

      return unhandled
    }
  }
}
