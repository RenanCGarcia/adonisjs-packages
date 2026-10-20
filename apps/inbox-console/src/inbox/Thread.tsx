import {
  Bot,
  Check,
  CheckCheck,
  CircleAlert,
  CircleCheckBig,
  Clock,
  Hand,
  PanelRight,
  SendHorizontal,
  ShieldAlert,
} from 'lucide-react'
import { useLayoutEffect, useRef, useState, type ComponentType, type ReactNode } from 'react'

import { ago, contactName, dateTimeOf, timeOf, useNow } from './format.ts'
import { CLOSE_REASONS, describeFact, STATUS_LABELS } from './messages.ts'
import type { Posture } from './posture.ts'
import { abilitiesOf } from './posture.ts'
import type { Agent, Message, MessageStatus, Queue, TicketDetail, TicketEvent } from './types.ts'
import { Avatar, Button, Chip } from './ui.tsx'

type Item =
  | { kind: 'message'; at: string; message: Message }
  | { kind: 'event'; at: string; event: TicketEvent }
  | { kind: 'day'; at: string; label: string }

const day = new Intl.DateTimeFormat('pt-BR', { day: 'numeric', month: 'long' })

function dayLabel(iso: string, now: number) {
  const date = new Date(iso)
  const today = new Date(now)
  const yesterday = new Date(now - 86_400_000)

  if (date.toDateString() === today.toDateString()) return 'Hoje'

  if (date.toDateString() === yesterday.toDateString()) return 'Ontem'

  return day.format(date)
}

/**
 * A transfer to a queue leaves the ticket unassigned. Its queue change already says so.
 */
function shown({ data }: TicketEvent) {
  return !(data.fact === 'assignment_changed' && data.via === 'transfer' && data.to === null)
}

function timeline(ticket: TicketDetail, now: number): Item[] {
  // A row without its timestamp yet is the newest thing in the thread.
  const latest = new Date(now).toISOString()

  const entries: Item[] = [
    ...ticket.messages.map(message => ({
      kind: 'message' as const,
      at: message.sentAt ?? latest,
      message,
    })),
    ...ticket.events.filter(shown).map(event => ({
      kind: 'event' as const,
      at: event.createdAt ?? latest,
      event,
    })),
  ].sort((a, b) => Date.parse(a.at) - Date.parse(b.at))

  const items: Item[] = []
  let lastDay = ''

  for (const entry of entries) {
    const label = dayLabel(entry.at, now)

    if (label !== lastDay) items.push({ kind: 'day', at: entry.at, label })

    lastDay = label
    items.push(entry)
  }

  return items
}

const STATUS_ICONS: Record<
  MessageStatus,
  { icon: ComponentType<{ className?: string }>; className: string }
> = {
  pending: { icon: Clock, className: 'text-current opacity-60' },
  sent: { icon: Check, className: 'text-current opacity-70' },
  delivered: { icon: CheckCheck, className: 'text-current opacity-70' },
  read: { icon: CheckCheck, className: 'text-sky-300' },
  played: { icon: CheckCheck, className: 'text-sky-300' },
  failed: { icon: CircleAlert, className: 'text-red-300' },
}

function Delivery({ status }: { status: MessageStatus }) {
  const { icon: Icon, className } = STATUS_ICONS[status]

  return (
    <span
      data-testid="delivery"
      data-status={status}
      className="inline-flex items-center gap-1"
      title={STATUS_LABELS[status]}
    >
      <Icon className={`size-3.5 ${className}`} aria-hidden />
      <span className={status === 'failed' ? 'font-medium' : 'sr-only'}>
        {STATUS_LABELS[status]}
      </span>
    </span>
  )
}

function Bubble({
  side,
  tone,
  author,
  text,
  time,
  status,
}: {
  side: 'left' | 'right'
  tone: 'contact' | 'agent' | 'bot'
  author: string | null
  text: string
  time: string
  status: MessageStatus | null
}) {
  const tones = {
    contact: 'bg-white text-slate-800 ring-1 ring-slate-200 rounded-bl-md',
    agent: 'bg-brand-600 text-white rounded-br-md',
    bot: 'bg-violet-100 text-violet-950 rounded-br-md',
  }

  return (
    <div
      data-testid="bubble"
      data-side={side}
      className={`flex flex-col ${side === 'right' ? 'items-end' : 'items-start'}`}
    >
      {author !== null && (
        <span className="mb-1 flex items-center gap-1 px-1 text-[11px] font-medium text-slate-500">
          {tone === 'bot' && <Bot className="size-3" aria-hidden />}
          {author}
        </span>
      )}
      <div
        className={`max-w-[min(34rem,80%)] rounded-2xl px-3.5 py-2 text-sm leading-relaxed shadow-sm ${tones[tone]}`}
      >
        <p className="break-words whitespace-pre-wrap">{text}</p>
        <span
          className={`mt-0.5 flex items-center justify-end gap-1.5 text-[11px] tabular-nums ${tone === 'agent' ? 'text-brand-100' : 'text-slate-400'}`}
        >
          {time}
          {status !== null && <Delivery status={status} />}
        </span>
      </div>
    </div>
  )
}

function Composer({
  ticketId,
  posture,
  onSend,
}: {
  ticketId: number
  posture: Posture
  onSend: (text: string) => Promise<boolean>
}) {
  const composer = abilitiesOf(posture).composer
  const [draft, setDraft] = useDraft(ticketId)
  const area = useRef<HTMLTextAreaElement>(null)

  useLayoutEffect(() => {
    const element = area.current

    if (element === null) return

    element.style.height = 'auto'
    element.style.height = `${Math.min(element.scrollHeight, 160)}px`
  }, [draft])

  if (!composer.enabled) {
    return (
      <div
        data-testid="composer-disabled"
        className="flex items-center gap-2 border-t border-slate-200 bg-slate-50 px-6 py-4 text-sm text-slate-500"
      >
        <ShieldAlert className="size-4 shrink-0 text-slate-400" aria-hidden />
        {composer.hint}
      </div>
    )
  }

  const send = () => {
    const text = draft.trim()

    if (text === '') return

    setDraft('')
    void onSend(text).then(sent => {
      if (!sent) setDraft(text)
    })
  }

  return (
    <form
      className="border-t border-slate-200 bg-white px-4 py-3"
      onSubmit={event => {
        event.preventDefault()
        send()
      }}
    >
      <div className="flex items-end gap-2 rounded-xl bg-slate-50 p-1.5 ring-1 ring-slate-200 focus-within:bg-white focus-within:ring-2 focus-within:ring-brand-500">
        <textarea
          ref={area}
          rows={1}
          data-testid="composer"
          value={draft}
          aria-label="Mensagem"
          placeholder={composer.placeholder}
          onChange={event => setDraft(event.target.value)}
          onKeyDown={event => {
            if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
              event.preventDefault()
              send()
            }
          }}
          className="max-h-40 min-h-9 flex-1 resize-none bg-transparent px-2.5 py-2 text-sm leading-5 placeholder:text-slate-400 focus:outline-none"
        />
        <Button
          type="submit"
          variant="primary"
          aria-label="Enviar"
          disabled={draft.trim() === ''}
          icon={<SendHorizontal className="size-4" aria-hidden />}
          size="icon"
        />
      </div>
      <p className="mt-1.5 px-1 text-[11px] text-slate-400">
        Enter envia · Shift + Enter quebra a linha
      </p>
    </form>
  )
}

const DRAFT_KEY = 'inbox-console.drafts'

function readDrafts(): Record<string, string> {
  try {
    // SAFETY: only `useDraft` writes this key, with a Record<string, string>.
    return JSON.parse(localStorage.getItem(DRAFT_KEY) ?? '{}') as Record<string, string>
  } catch {
    return {}
  }
}

/**
 * The unsent text of one conversation, kept while the agent looks at others.
 */
function useDraft(ticketId: number) {
  const [drafts, setDrafts] = useState(readDrafts)
  const draft = drafts[ticketId] ?? ''

  const setDraft = (text: string) => {
    const { [ticketId]: _previous, ...others } = drafts
    const next = text === '' ? others : { ...others, [ticketId]: text }

    setDrafts(next)

    try {
      localStorage.setItem(DRAFT_KEY, JSON.stringify(next))
    } catch {
      // Without storage the drafts last until the tab closes.
    }
  }

  return [draft, setDraft] as const
}

function Banner({ posture }: { posture: Posture }) {
  if (posture.kind !== 'other' && posture.kind !== 'outsider') return null

  return (
    <div
      data-testid="banner"
      className="flex items-center gap-2 border-b border-amber-200 bg-amber-50 px-6 py-2.5 text-sm text-amber-900"
    >
      {posture.kind === 'other' ? (
        <>
          <Hand className="size-4 shrink-0" aria-hidden />
          Em atendimento por <strong className="font-semibold">{posture.holder}</strong>
        </>
      ) : (
        <>
          <ShieldAlert className="size-4 shrink-0" aria-hidden />
          Você não faz parte da fila <strong className="font-semibold">{posture.queue}</strong>.
          Transfira ou atribua a alguém da fila.
        </>
      )}
    </div>
  )
}

export function Thread({
  ticket,
  me,
  agents,
  queues,
  posture,
  replying,
  pending,
  sidebarOpen,
  onToggleSidebar,
  onAssume,
  onResolve,
  onSend,
}: {
  ticket: TicketDetail
  me: Agent | undefined
  agents: Agent[]
  queues: Queue[]
  posture: Posture
  replying: string | null
  pending: boolean
  sidebarOpen: boolean
  onToggleSidebar: () => void
  onAssume: () => void
  onResolve: () => void
  onSend: (text: string) => Promise<boolean>
}) {
  const now = useNow()
  const name = contactName(ticket.contact)
  const abilities = abilitiesOf(posture)
  const items = timeline(ticket, now)
  const scroller = useRef<HTMLDivElement>(null)
  const atBottom = useRef(true)
  const shownTicket = useRef<number | null>(null)

  const nameOf = (ref: { kind: string; id: number }) => {
    if (me !== undefined && ref.id === me.id) return 'você'

    return (
      agents.find(agent => agent.id === ref.id)?.name ??
      (ref.kind === 'bot' ? 'o bot' : 'um agente')
    )
  }

  const queueName = (id: number) => queues.find(queue => queue.id === id)?.name ?? `#${id}`

  // A new message scrolls the thread only when the agent was already reading its end.
  useLayoutEffect(() => {
    const element = scroller.current

    if (element === null) return

    if (shownTicket.current !== ticket.id || atBottom.current) {
      element.scrollTop = element.scrollHeight
      atBottom.current = true
    }

    shownTicket.current = ticket.id
  }, [ticket.id, items.length, replying])

  return (
    <section
      aria-label={`Conversa com ${name}`}
      className="flex min-h-0 min-w-0 flex-1 flex-col bg-slate-50"
    >
      <header className="flex items-center gap-3 border-b border-slate-200 bg-white px-6 py-3">
        <Avatar name={name} tone={`contact-${ticket.contact.id}`} />
        <div className="min-w-0 flex-1">
          <h2
            data-testid="thread-title"
            className="truncate text-[15px] font-semibold text-slate-900"
          >
            {name}
          </h2>
          <p className="truncate text-xs text-slate-500">
            {ticket.contact.address} · {ticket.channel.name}
          </p>
        </div>

        {abilities.primary === 'assume' && (
          <Button variant="primary" busy={pending} onClick={onAssume} data-testid="primary-action">
            Assumir conversa
          </Button>
        )}
        {abilities.primary === 'assumeFromBot' && (
          <Button
            variant="primary"
            busy={pending}
            onClick={onAssume}
            data-testid="primary-action"
            icon={<Bot className="size-4" aria-hidden />}
          >
            Assumir do bot
          </Button>
        )}
        {abilities.primary === 'resolve' && (
          <Button
            variant="primary"
            busy={pending}
            onClick={onResolve}
            data-testid="primary-action"
            icon={<CircleCheckBig className="size-4" aria-hidden />}
          >
            Resolver
          </Button>
        )}
        {posture.kind === 'closed' && (
          <Chip tone="emerald">
            <CircleCheckBig className="size-3.5" aria-hidden />
            Resolvida
          </Chip>
        )}
        <Button
          variant="ghost"
          aria-label={sidebarOpen ? 'Esconder detalhes' : 'Mostrar detalhes'}
          aria-pressed={sidebarOpen}
          onClick={onToggleSidebar}
          icon={<PanelRight className="size-4" aria-hidden />}
          size="icon"
        />
      </header>

      <Banner posture={posture} />

      <div
        ref={scroller}
        data-testid="thread"
        onScroll={event => {
          const element = event.currentTarget

          atBottom.current = element.scrollHeight - element.scrollTop - element.clientHeight < 80
        }}
        className="min-h-0 flex-1 overflow-y-auto px-6 py-5"
      >
        <div className="mx-auto flex max-w-3xl flex-col gap-3">
          {items.map(item => {
            if (item.kind === 'day') {
              return (
                <div key={`day-${item.at}`} className="my-2 flex justify-center">
                  <span className="rounded-full bg-white px-3 py-1 text-[11px] font-medium text-slate-500 shadow-sm ring-1 ring-slate-200">
                    {item.label}
                  </span>
                </div>
              )
            }

            if (item.kind === 'event') {
              const { event } = item

              const actor =
                me !== undefined && event.actor.id === me.id
                  ? 'Você'
                  : event.actor.kind === 'bot'
                    ? `Bot ${event.actor.name}`
                    : event.actor.name

              return (
                <p
                  key={`event-${event.id}`}
                  data-testid="timeline-event"
                  title={dateTimeOf(event.createdAt)}
                  className="flex items-center gap-3 text-[11px] text-slate-400 before:h-px before:flex-1 before:bg-slate-200 after:h-px after:flex-1 after:bg-slate-200"
                >
                  <span className="max-w-[70%] text-center">
                    {describeFact(event.data, actor, nameOf, queueName)} · {timeOf(event.createdAt)}
                  </span>
                </p>
              )
            }

            const { message } = item
            const author = message.author
            const mine = me !== undefined && author?.id === me.id

            return (
              <Bubble
                key={`message-${message.id}`}
                side={message.direction === 'inbound' ? 'left' : 'right'}
                tone={
                  message.direction === 'inbound'
                    ? 'contact'
                    : author?.kind === 'bot'
                      ? 'bot'
                      : 'agent'
                }
                author={
                  message.direction === 'inbound'
                    ? null
                    : mine
                      ? 'Você'
                      : (author?.name ?? 'Sistema')
                }
                text={message.text}
                time={timeOf(message.sentAt)}
                status={message.direction === 'inbound' ? null : (message.status ?? 'pending')}
              />
            )
          })}
          {replying !== null && (
            <Bubble
              side="right"
              tone="agent"
              author="Você"
              text={replying}
              time="agora"
              status="pending"
            />
          )}
          {ticket.status === 'closed' && ticket.closedAt !== null && (
            <p className="mt-2 text-center text-xs text-slate-500">
              Resolvida {ago(ticket.closedAt, now)}
              {ticket.closeReason !== null && ` · ${CLOSE_REASONS[ticket.closeReason].label}`}
            </p>
          )}
        </div>
      </div>

      <Composer key={ticket.id} ticketId={ticket.id} posture={posture} onSend={onSend} />
    </section>
  )
}

export function NoThread({ children }: { children: ReactNode }) {
  return (
    <section className="flex flex-1 flex-col items-center justify-center gap-3 bg-slate-50 text-center">
      <span className="flex size-14 items-center justify-center rounded-2xl bg-white shadow-sm ring-1 ring-slate-200">
        <SendHorizontal className="size-6 text-brand-500" aria-hidden />
      </span>
      <div className="max-w-xs text-sm text-slate-500">{children}</div>
    </section>
  )
}
