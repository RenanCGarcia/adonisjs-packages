import type { EmitterService, LoggerService } from '@adonisjs/core/types'
import type { Database } from '@adonisjs/lucid/database'
import type { TransactionClientContract } from '@adonisjs/lucid/types/database'
import { DateTime } from 'luxon'

import type { ResolvedInboxConfig } from './define_config.ts'
import { InboxError } from './errors.ts'
import {
  affectedRows,
  columnsOf,
  Conflict,
  findOrCreate,
  unitOfWork,
} from './internal/unit_of_work.ts'
import type { InboxModelOf } from './mixins/main.ts'
import { holder, plan, planOpening, questionsFor, type PlanContext } from './ticket/plan.ts'
import { toRow } from './ticket/row.ts'
import type {
  Actor,
  ApplyResult,
  Attendant,
  AttendantId,
  BotKey,
  ConversationId,
  Gesture,
  HostUserId,
  QueueId,
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
 * What a plan relied on that another writer could change before the write lands.
 */
interface Reliance {
  memberships: Array<[AttendantId, QueueId]>
  activeAttendants: AttendantId[]
}

export class Inbox {
  readonly #config: ResolvedInboxConfig
  readonly #db: Database
  readonly #emitter: EmitterService
  readonly #logger: LoggerService

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
  }

  readonly tickets = {
    /**
     * Every ticket transition. It reads the ticket, plans the gesture and writes it with a
     * compare-and-swap on `version`. When the ticket moved in between, it reads and plans again,
     * up to three times, running `authorize` and the membership rule against each fresh read.
     */
    apply: (id: TicketId, gesture: Gesture, actor: Actor): Promise<ApplyResult> =>
      this.#write(id, actor, () => gesture, this.#config.authorize),

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
    open: async (conversationId: ConversationId, queueId: QueueId, actor: Actor) => {
      const Ticket = await this.#config.model('ticket')
      const openIn = () => Ticket.query().where('openConversationId', conversationId).first()
      const existing = await openIn()

      if (existing !== null) return { opened: false, ticket: existing.snapshot }

      const Conversation = await this.#config.model('conversation')
      const Channel = await this.#config.model('channel')
      const conversation = await Conversation.findOrFail(conversationId)
      const channel = await Channel.findOrFail(conversation.channelId)
      const opening = planOpening(queueId, 'outbound')
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

  async #write(
    id: TicketId,
    actor: Actor,
    decide: (ticket: TicketSnapshot) => Gesture | null,
    authorize: ResolvedInboxConfig['authorize'],
  ): Promise<ApplyResult> {
    const Ticket = await this.#config.model('ticket')

    for (let attempt = 0; attempt < ATTEMPTS; attempt++) {
      const row = await Ticket.findOrFail(id)
      const ticket = row.snapshot
      const gesture = decide(ticket)

      if (gesture === null) return { outcome: 'unchanged', ticket }

      const { context, current, reliance } = await this.#contextFor(ticket, gesture, actor)

      if (!(await authorize({ actor: current, operation: gesture, ticket }))) {
        return { outcome: 'rejected', reason: 'forbidden' }
      }

      const planned = plan(ticket, gesture, current, context)

      if (planned.outcome === 'rejected') return planned

      if (planned.outcome === 'unchanged') return { outcome: 'unchanged', ticket }

      try {
        await unitOfWork(this.#db, async (trx, later) => {
          await this.#compareAndSwap(trx, row, planned.next)
          await this.#reassert(trx, reliance)
          await this.#record(trx, ticket.id, planned.facts, current, gesture.note)

          later(() =>
            this.#emit(() =>
              this.#emitter.emit('inbox:ticket_changed', {
                ticketId: ticket.id,
                change: gesture.gesture,
                from: ticket.state,
                to: planned.next.state,
                facts: planned.facts,
              }),
            ),
          )
        })

        return { outcome: 'changed', ticket: planned.next, facts: planned.facts }
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
  async #contextFor(ticket: TicketSnapshot, gesture: Gesture, actor: Actor) {
    const Attendant = await this.#config.model('attendant')
    const QueueMember = await this.#config.model('queueMember')

    const targetId =
      gesture.gesture === 'assign' || gesture.gesture === 'transfer' ? gesture.to : undefined

    const ids = [actor.kind === 'system' ? undefined : actor.id, targetId].filter(
      (attendantId): attendantId is AttendantId => attendantId !== undefined,
    )

    const rows = ids.length === 0 ? [] : await Attendant.query().whereIn('id', ids)
    const attendants = new Map(rows.map(row => [row.id, row.asAttendant]))

    // A vanished attendant can't hold a ticket, which is what inactive means to `plan`.
    const current: Actor =
      actor.kind === 'system' ? actor : (attendants.get(actor.id) ?? { ...actor, active: false })

    const target = targetId === undefined ? undefined : attendants.get(targetId)
    const questions = questionsFor(ticket, gesture, current)

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
        ticket => {
          const current = holder(ticket.state)

          const stillHeld =
            current?.id === attendantId && (queueId === null || ticket.state.queueId === queueId)

          return stillHeld ? { gesture: 'return' } : null
        },
        () => true,
      )
    }
  }

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
