import { Bot, Search, UserRound } from 'lucide-react'

import { ago, contactName, useNow } from './format.ts'
import type { Agent, Channel, TicketRow } from './types.ts'
import { Avatar, Chip, Menu, Skeleton } from './ui.tsx'

function preview(row: TicketRow, me: Agent | undefined) {
  const last = row.lastMessage

  if (last === null) return 'Sem mensagens'

  if (last.direction === 'inbound') return last.text

  if (last.author === null) return last.text

  if (me !== undefined && last.author.id === me.id) return `Você: ${last.text}`

  return `${last.author.kind === 'bot' ? 'Bot' : last.author.name.split(' ')[0]}: ${last.text}`
}

function Row({
  row,
  me,
  now,
  selected,
  onOpen,
}: {
  row: TicketRow
  me: Agent | undefined
  now: number
  selected: boolean
  onOpen: () => void
}) {
  const name = contactName(row.contact)
  const unread = row.unreadCount > 0 && row.status !== 'closed'

  return (
    <li>
      <button
        type="button"
        data-testid="ticket-row"
        data-ticket-id={row.id}
        aria-current={selected ? 'true' : undefined}
        onClick={onOpen}
        className={`relative flex w-full gap-3 border-b border-slate-100 px-4 py-3 text-left transition-colors ${selected ? 'bg-brand-50' : 'hover:bg-slate-50'}`}
      >
        {selected && <span className="absolute inset-y-0 left-0 w-0.5 bg-brand-600" />}
        <Avatar name={name} tone={`contact-${row.contact.id}`} />
        <span className="min-w-0 flex-1">
          <span className="flex items-baseline gap-2">
            <span
              className={`flex-1 truncate text-sm ${unread ? 'font-semibold text-slate-900' : 'font-medium text-slate-800'}`}
            >
              {name}
            </span>
            <span
              className={`shrink-0 text-xs tabular-nums ${unread ? 'font-semibold text-brand-600' : 'text-slate-400'}`}
            >
              {ago(row.lastActivityAt, now)}
            </span>
          </span>
          <span className="mt-0.5 flex items-center gap-2">
            <span
              className={`flex-1 truncate text-[13px] ${unread ? 'text-slate-700' : 'text-slate-500'}`}
            >
              {preview(row, me)}
            </span>
            {unread && (
              <span
                aria-label={`${row.unreadCount} não lidas`}
                className="min-w-5 shrink-0 rounded-full bg-brand-600 px-1.5 text-center text-[11px] leading-5 font-semibold text-white tabular-nums"
              >
                {row.unreadCount}
              </span>
            )}
          </span>
          <span className="mt-1.5 flex flex-wrap items-center gap-1">
            <Chip>{row.queue.name}</Chip>
            {row.assignee === null ? (
              row.status === 'queued' && <Chip tone="amber">Na fila</Chip>
            ) : (
              <Chip tone={row.assignee.kind === 'bot' ? 'violet' : 'neutral'}>
                {row.assignee.kind === 'bot' ? (
                  <Bot className="size-3" aria-hidden />
                ) : (
                  <UserRound className="size-3" aria-hidden />
                )}
                {me !== undefined && row.assignee.id === me.id ? 'Você' : row.assignee.name}
              </Chip>
            )}
          </span>
        </span>
      </button>
    </li>
  )
}

export function TicketList({
  rows,
  loading,
  me,
  selectedId,
  onOpen,
  empty,
  search,
  onSearch,
  channels,
  channelId,
  onChannel,
}: {
  rows: TicketRow[] | undefined
  loading: boolean
  me: Agent | undefined
  selectedId: number | null
  onOpen: (ticketId: number) => void
  empty: string
  search: string
  onSearch: (search: string) => void
  channels: Channel[]
  channelId: Channel['id'] | null
  onChannel: (channelId: Channel['id'] | null) => void
}) {
  const now = useNow()
  const channel = channels.find(candidate => candidate.id === channelId)

  return (
    <section
      aria-label="Conversas"
      className="flex min-h-0 flex-1 flex-col border-r border-slate-200 bg-white"
    >
      <div className="flex flex-col gap-2 border-b border-slate-200 p-3">
        <label className="relative block">
          <span className="sr-only">Buscar por nome ou telefone</span>
          <Search
            className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-slate-400"
            aria-hidden
          />
          <input
            type="search"
            data-testid="search"
            value={search}
            onChange={event => onSearch(event.target.value)}
            placeholder="Buscar por nome ou telefone"
            className="h-9 w-full rounded-lg bg-slate-100 pr-3 pl-9 text-sm placeholder:text-slate-400 focus:bg-white focus:ring-2 focus:ring-brand-500 focus:outline-none"
          />
        </label>
        <Menu
          label={channel === undefined ? 'Todos os canais' : channel.name}
          testId="channel-filter"
          onPick={onChannel}
          options={[
            { value: null, label: 'Todos os canais', selected: channelId === null },
            ...channels.map(candidate => ({
              value: candidate.id,
              label: candidate.name,
              detail: `Fila ${candidate.defaultQueue.name}`,
              selected: candidate.id === channelId,
            })),
          ]}
        />
      </div>

      <ul data-testid="ticket-list" className="min-h-0 flex-1 overflow-y-auto">
        {rows === undefined &&
          loading &&
          Array.from({ length: 7 }, (_, index) => (
            <li key={index} className="flex gap-3 border-b border-slate-100 px-4 py-3.5">
              <Skeleton className="size-9 rounded-full" />
              <span className="flex flex-1 flex-col gap-2">
                <Skeleton className="h-3.5 w-2/5" />
                <Skeleton className="h-3 w-4/5" />
                <Skeleton className="h-3 w-1/4" />
              </span>
            </li>
          ))}
        {rows?.map(row => (
          <Row
            key={row.id}
            row={row}
            me={me}
            now={now}
            selected={row.id === selectedId}
            onOpen={() => onOpen(row.id)}
          />
        ))}
        {rows !== undefined && rows.length === 0 && (
          <li data-testid="list-empty" className="px-6 py-16 text-center text-sm text-slate-500">
            {search.trim() === '' ? empty : `Nada encontrado para "${search.trim()}".`}
          </li>
        )}
      </ul>
    </section>
  )
}
