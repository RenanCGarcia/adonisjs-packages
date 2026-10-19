import { randomUUID } from 'node:crypto'

import type { EmitterService, LoggerService } from '@adonisjs/core/types'
import type { Database } from '@adonisjs/lucid/database'
import type { TransactionClientContract } from '@adonisjs/lucid/types/database'
import { DateTime } from 'luxon'

import type { ContactIdentity, NormalizedEvent, WebhookRequest } from './adapters/port.ts'
import type { AuthorizeQuestion, ResolvedInboxConfig } from './define_config.ts'
import { InboxError } from './errors.ts'
import { dispatchMessage, whereInFlight } from './internal/outbox.ts'
import {
  affectedRows,
  columnsOf,
  Conflict,
  findOrCreate,
  sqlTime,
  unitOfWork,
  type Later,
} from './internal/unit_of_work.ts'
import { advanceableFrom } from './message/status.ts'
import type { InboxModelOf } from './mixins/main.ts'
import { retryOf, type InboxTask, type TaskDriver } from './tasks.ts'
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
  MessageId,
  MessageStatus,
  OutgoingText,
  QueueId,
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
 * What a plan relied on that another writer could change before the write lands.
 */
interface Reliance {
  memberships: Array<[AttendantId, QueueId]>
  activeAttendants: AttendantId[]
}

interface TicketWrite {
  decide: (ticket: TicketSnapshot) => TicketChange | null
  /**
   * Asks `config.authorize` about this operation on every attempt.
   */
  authorizeAs?: AuthorizeQuestion['operation']
  /**
   * More writes that land, or roll back, with the ticket's. A ticket the change leaves unchanged
   * is still compared and swapped, so these never land on a ticket that moved.
   */
  within?: (trx: TransactionClientContract, ticket: TicketSnapshot, later: Later) => Promise<void>
}

type ChannelRow = InstanceType<InboxModelOf<'channel'>>

export class Inbox {
  readonly #config: ResolvedInboxConfig
  readonly #db: Database
  readonly #emitter: EmitterService
  readonly #logger: LoggerService
  readonly #tasks: TaskDriver

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

  readonly tickets = {
    /**
     * Every ticket transition. It reads the ticket, plans the gesture and writes it with a
     * compare-and-swap on `version`. When the ticket moved in between, it reads and plans again,
     * up to three times, running `authorize` and the membership rule against each fresh read.
     */
    apply: (id: TicketId, gesture: Gesture, actor: Actor): Promise<ApplyResult> =>
      this.#write(id, actor, { decide: () => gesture, authorizeAs: gesture }),

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
     * the first call stored.
     */
    send: async (
      id: TicketId,
      message: OutgoingText,
      author: Attendant,
      options: SendMessageOptions = {},
    ): Promise<SendOutcome> => {
      const Message = await this.#config.model('message')
      const clientRef = options.clientRef ?? randomUUID()
      const stored = () => Message.findBy('clientRef', clientRef)
      const replayed = options.clientRef === undefined ? null : await stored()

      if (replayed !== null) return this.#queued(id, replayed.id)

      const now = DateTime.now()
      let result: ApplyResult

      try {
        result = await this.#write(id, author, {
          decide: () => ({ gesture: 'reply', at: now }),
          authorizeAs: { gesture: 'send' },
          within: async (trx, ticket, later) => {
            const channel = await this.#channelOf(ticket.conversationId, trx)

            const row = await Message.create(
              {
                ...this.#config.ownership(channel),
                conversationId: ticket.conversationId,
                ticketId: ticket.id,
                direction: 'outbound',
                body: message.text,
                status: 'pending',
                authorId: author.id,
                clientRef,
                sentAt: now,
              },
              { client: trx },
            )

            later(() => this.#enqueue({ task: 'dispatch', messageId: row.id, attempt: 0 }))
          },
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
    bot: async (key: BotKey) => {
      if (!this.#config.bots.has(key)) {
        throw new InboxError('E_INBOX_UNKNOWN_BOT', `inbox: "${key}" is not in config.bots`)
      }

      const Attendant = await this.#config.model('attendant')

      const row = await findOrCreate(
        () => Attendant.findBy('botKey', key),
        () => Attendant.create({ kind: 'bot', botKey: key }),
      )

      return row.asAttendant
    },

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

        return { opened: true, ticket: row.snapshot }
      })
    } catch (error) {
      const winner = await openIn()

      if (winner !== null) return { opened: false, ticket: winner.snapshot }

      throw error
    }
  }

  async #write(id: TicketId, actor: Actor, write: TicketWrite): Promise<ApplyResult> {
    const Ticket = await this.#config.model('ticket')

    for (let attempt = 0; attempt < ATTEMPTS; attempt++) {
      const row = await Ticket.findOrFail(id)
      const ticket = row.snapshot
      const change = write.decide(ticket)

      if (change === null) return { outcome: 'unchanged', ticket }

      const { context, current, reliance } = await this.#contextFor(ticket, change, actor)

      const allowed =
        write.authorizeAs === undefined ||
        (await this.#config.authorize({ actor: current, operation: write.authorizeAs, ticket }))

      if (!allowed) return { outcome: 'rejected', reason: 'forbidden' }

      const planned = planChange(ticket, change, current, context)

      if (planned.outcome === 'rejected') return planned

      if (planned.outcome === 'unchanged' && write.within === undefined) {
        return { outcome: 'unchanged', ticket }
      }

      const changed = planned.outcome === 'changed'
      const next = changed ? planned.next : ticket
      const facts = changed ? planned.facts : []

      try {
        await unitOfWork(this.#db, async (trx, later) => {
          await this.#compareAndSwap(trx, row, next)
          await this.#reassert(trx, reliance)
          await this.#record(
            trx,
            ticket.id,
            facts,
            current,
            'note' in change ? change.note : undefined,
          )
          await write.within?.(trx, next, later)

          const name = change.gesture

          if (!changed || name === 'inbound' || name === 'bot_state') return

          later(() =>
            this.#emit(() =>
              this.#emitter.emit('inbox:ticket_changed', {
                ticketId: ticket.id,
                change: name,
                from: ticket.state,
                to: next.state,
                facts,
              }),
            ),
          )
        })

        return changed
          ? { outcome: 'changed', ticket: next, facts }
          : { outcome: 'unchanged', ticket }
      } catch (error) {
        if (!(error instanceof Conflict)) throw error
      }
    }

    return { outcome: 'rejected', reason: 'conflict' }
  }

  /**
   * Reads what `plan` can't: the actor and the target as they are now, and the memberships
   * `questionsFor` names.
   */
  async #contextFor(ticket: TicketSnapshot, change: TicketChange, actor: Actor) {
    const Attendant = await this.#config.model('attendant')
    const QueueMember = await this.#config.model('queueMember')

    const targetId =
      change.gesture === 'assign' || change.gesture === 'transfer' ? change.to : undefined

    const ids = [actor.kind === 'system' ? undefined : actor.id, targetId].filter(
      (attendantId): attendantId is AttendantId => attendantId !== undefined,
    )

    const rows = ids.length === 0 ? [] : await Attendant.query().whereIn('id', ids)
    const attendants = new Map(rows.map(row => [row.id, row.asAttendant]))

    // A vanished attendant can't hold a ticket, which is what inactive means to `plan`.
    const current: Actor =
      actor.kind === 'system' ? actor : (attendants.get(actor.id) ?? { ...actor, active: false })

    const target = targetId === undefined ? undefined : attendants.get(targetId)
    const questions = questionsFor(ticket, change, current)

    const members =
      questions.length === 0
        ? []
        : await QueueMember.query().where(query => {
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

            return stillHeld ? { gesture: 'return' } : null
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
          decide: () => ({ gesture: 'inbound', sentAt: event.sentAt }),
          within: async (trx, current, later) => {
            const message = await Message.create(
              {
                ...this.#config.ownership(channel),
                conversationId: conversation.id,
                ticketId: current.id,
                direction: 'inbound',
                body: event.text,
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
        body: event.text,
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

  async #channelOf(conversationId: ConversationId, trx: TransactionClientContract) {
    const Conversation = await this.#config.model('conversation')
    const Channel = await this.#config.model('channel')
    const conversation = await Conversation.findOrFail(conversationId, { client: trx })

    return Channel.findOrFail(conversation.channelId, { client: trx })
  }

  async #queued(id: TicketId, messageId: MessageId): Promise<SendOutcome> {
    const Ticket = await this.#config.model('ticket')
    const ticket = await Ticket.findOrFail(id)

    return { outcome: 'queued', messageId, ticket: ticket.snapshot }
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
