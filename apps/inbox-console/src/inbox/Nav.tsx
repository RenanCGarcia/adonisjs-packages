import { Bot, CircleCheckBig, Inbox, Layers, UserRound, UsersRound } from 'lucide-react'
import type { ComponentType, ReactNode } from 'react'

import { VIEW_LABELS } from './messages.ts'
import type { Queue, Selection, View } from './types.ts'

const VIEW_ICONS: Record<View, ComponentType<{ className?: string }>> = {
  mine: UserRound,
  unassigned: Inbox,
  bot: Bot,
  open: UsersRound,
  closed: CircleCheckBig,
}

// SAFETY: VIEW_LABELS is a Record<View, string>, so its keys are exactly the views, in nav order.
const VIEWS = Object.keys(VIEW_LABELS) as View[]

function NavItem({
  active,
  icon,
  label,
  count,
  emphasize,
  onClick,
  testId,
}: {
  active: boolean
  icon: ReactNode
  label: string
  count: number | undefined
  emphasize: boolean
  onClick: () => void
  testId: string
}) {
  return (
    <button
      type="button"
      aria-current={active ? 'page' : undefined}
      data-testid={testId}
      onClick={onClick}
      className={`group flex h-9 w-full items-center gap-2.5 rounded-lg px-2.5 text-sm transition-colors ${active ? 'bg-white font-semibold text-slate-900 shadow-sm ring-1 ring-slate-200' : 'text-slate-600 hover:bg-slate-200/60 hover:text-slate-900'}`}
    >
      {icon}
      <span className="flex-1 truncate text-left">{label}</span>
      {count !== undefined && (
        <span
          data-testid="count"
          className={`min-w-6 rounded-full px-1.5 text-center text-xs tabular-nums ${emphasize && count > 0 ? 'bg-brand-600 font-semibold text-white' : 'text-slate-500'}`}
        >
          {count}
        </span>
      )}
    </button>
  )
}

export function Nav({
  selection,
  onSelect,
  views,
  queueCounts,
  queues,
}: {
  selection: Selection
  onSelect: (selection: Selection) => void
  views: Record<View, number> | undefined
  queueCounts: Record<string, number> | undefined
  queues: Queue[]
}) {
  return (
    <nav aria-label="Caixas" className="flex flex-col gap-6 overflow-y-auto px-3 py-4">
      <div className="flex flex-col gap-0.5">
        {VIEWS.map(view => {
          const Icon = VIEW_ICONS[view]

          return (
            <NavItem
              key={view}
              testId={`view-${view}`}
              active={selection.kind === 'view' && selection.view === view}
              icon={<Icon className="size-4 shrink-0 text-slate-500" />}
              label={VIEW_LABELS[view]}
              count={views?.[view]}
              emphasize={view === 'unassigned' || view === 'mine'}
              onClick={() => onSelect({ kind: 'view', view })}
            />
          )
        })}
      </div>

      <div>
        <h3 className="mb-1.5 px-2.5 text-[11px] font-semibold tracking-wider text-slate-400 uppercase">
          Filas
        </h3>
        <div className="flex flex-col gap-0.5">
          {queues.map(queue => (
            <NavItem
              key={queue.id}
              testId={`queue-${queue.name}`}
              active={selection.kind === 'queue' && selection.queueId === queue.id}
              icon={<Layers className="size-4 shrink-0 text-slate-400" />}
              label={queue.name}
              count={queueCounts === undefined ? undefined : (queueCounts[queue.id] ?? 0)}
              emphasize={false}
              onClick={() => onSelect({ kind: 'queue', queueId: queue.id })}
            />
          ))}
        </div>
      </div>
    </nav>
  )
}
