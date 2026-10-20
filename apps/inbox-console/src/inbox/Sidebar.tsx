import { ArrowRightLeft, CircleCheckBig, Undo2, UserRoundPlus, Workflow } from 'lucide-react'
import type { ReactNode } from 'react'

import { useFlowRuns } from './api.ts'
import { ago, contactName, useNow } from './format.ts'
import { abilitiesOf, type Posture } from './posture.ts'
import type { Agent, FlowRun, Queue, TicketDetail } from './types.ts'
import { Avatar, Button, Chip, Menu, type ChipTone } from './ui.tsx'

const STATUS: Record<TicketDetail['status'], { label: string; tone: ChipTone }> = {
  queued: { label: 'Na fila', tone: 'amber' },
  in_progress: { label: 'Em atendimento', tone: 'sky' },
  closed: { label: 'Resolvida', tone: 'emerald' },
}

const RUN_STATUS: Record<FlowRun['status'], string> = {
  pending: 'Agendado',
  running: 'Em andamento',
  ended: 'Encerrado',
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="border-b border-slate-200 px-5 py-4">
      <h3 className="mb-3 text-[11px] font-semibold tracking-wider text-slate-400 uppercase">
        {title}
      </h3>
      {children}
    </section>
  )
}

function Detail({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3 py-1 text-sm">
      <dt className="text-slate-500">{label}</dt>
      <dd className="min-w-0 truncate text-right font-medium text-slate-800">{children}</dd>
    </div>
  )
}

function Runs({ ticketId }: { ticketId: number }) {
  const runs = useFlowRuns(ticketId)

  if (runs.data === undefined || runs.data.length === 0) return null

  return (
    <Section title="Automações">
      <ul className="flex flex-col gap-2">
        {runs.data.map(run => (
          <li key={run.id} className="flex items-center gap-2 text-sm text-slate-700">
            <Workflow className="size-4 text-violet-500" aria-hidden />
            <span className="flex-1">Fluxo #{run.flowId}</span>
            <Chip tone={run.status === 'ended' ? 'neutral' : 'violet'}>
              {RUN_STATUS[run.status]}
            </Chip>
          </li>
        ))}
      </ul>
    </Section>
  )
}

export function Sidebar({
  ticket,
  posture,
  me,
  agents,
  queues,
  pending,
  onAssign,
  onTransfer,
  onGiveBack,
  onResolve,
}: {
  ticket: TicketDetail
  posture: Posture
  me: Agent | undefined
  agents: Agent[]
  queues: Queue[]
  pending: boolean
  onAssign: (userId: number) => void
  onTransfer: (queueId: number) => void
  onGiveBack: () => void
  onResolve: () => void
}) {
  const now = useNow()
  const abilities = abilitiesOf(posture)
  const name = contactName(ticket.contact)
  const status = STATUS[ticket.status]

  const members = agents.filter(
    agent => agent.active && agent.queues.some(queue => queue.id === ticket.queue.id),
  )

  return (
    <aside
      aria-label="Detalhes da conversa"
      data-testid="sidebar"
      className="flex w-80 shrink-0 flex-col overflow-y-auto border-l border-slate-200 bg-white"
    >
      <div className="flex flex-col items-center gap-2 border-b border-slate-200 px-5 py-6 text-center">
        <Avatar name={name} tone={`contact-${ticket.contact.id}`} size="lg" />
        <div>
          <p className="font-semibold text-slate-900">{name}</p>
          <p className="text-sm text-slate-500">{ticket.contact.address}</p>
        </div>
      </div>

      <Section title="Atendimento">
        <dl>
          <Detail label="Situação">
            <Chip tone={status.tone}>{status.label}</Chip>
          </Detail>
          <Detail label="Fila">{ticket.queue.name}</Detail>
          <Detail label="Com">
            {ticket.assignee === null
              ? 'Ninguém'
              : me !== undefined && ticket.assignee.id === me.id
                ? 'Você'
                : ticket.assignee.name}
          </Detail>
          <Detail label="Canal">{ticket.channel.name}</Detail>
          <Detail label="Aberta">{ago(ticket.openedAt, now)}</Detail>
        </dl>

        {(abilities.assign || abilities.transfer || abilities.giveBack || abilities.resolve) && (
          <div className="mt-4 flex flex-col gap-2">
            {abilities.assign && (
              <Menu
                label="Atribuir a…"
                testId="assign"
                empty="Ninguém ativo nesta fila."
                onPick={onAssign}
                trigger={
                  <ActionRow icon={<UserRoundPlus className="size-4" aria-hidden />} busy={pending}>
                    Atribuir a…
                  </ActionRow>
                }
                options={members.map(agent => ({
                  value: agent.userId,
                  label:
                    me !== undefined && agent.id === me.id
                      ? `${agent.name} (você)`
                      : (agent.name ?? agent.email),
                  detail: `${agent.openTickets} em atendimento`,
                  icon: <Avatar name={agent.name ?? agent.email} tone={agent.email} size="sm" />,
                  selected: ticket.assignee?.id === agent.id,
                  disabled: ticket.assignee?.id === agent.id,
                }))}
              />
            )}
            {abilities.transfer && (
              <Menu
                label="Transferir para fila…"
                testId="transfer"
                onPick={onTransfer}
                trigger={
                  <ActionRow
                    icon={<ArrowRightLeft className="size-4" aria-hidden />}
                    busy={pending}
                  >
                    Transferir para fila…
                  </ActionRow>
                }
                options={queues.map(queue => ({
                  value: queue.id,
                  label: queue.name,
                  detail: `${queue.queued} na fila · ${queue.members} pessoas`,
                  selected: queue.id === ticket.queue.id,
                  disabled: queue.id === ticket.queue.id,
                }))}
              />
            )}
            {abilities.giveBack && ticket.status === 'in_progress' && (
              <button
                type="button"
                data-testid="give-back"
                onClick={onGiveBack}
                disabled={pending}
                className="w-full"
              >
                <ActionRow icon={<Undo2 className="size-4" aria-hidden />} busy={pending}>
                  Devolver à fila
                </ActionRow>
              </button>
            )}
            {abilities.resolve && (
              <Button
                variant="secondary"
                data-testid="sidebar-resolve"
                onClick={onResolve}
                disabled={pending}
                icon={<CircleCheckBig className="size-4 text-emerald-600" aria-hidden />}
                className="mt-1 w-full"
              >
                Resolver
              </Button>
            )}
          </div>
        )}
      </Section>

      <Runs ticketId={ticket.id} />
    </aside>
  )
}

function ActionRow({
  icon,
  busy,
  children,
}: {
  icon: ReactNode
  busy: boolean
  children: ReactNode
}) {
  return (
    <span
      className={`flex h-9 w-full items-center gap-2.5 rounded-lg px-3 text-sm text-slate-700 ring-1 ring-slate-200 ring-inset hover:bg-slate-50 ${busy ? 'opacity-60' : ''}`}
    >
      <span className="text-slate-400">{icon}</span>
      {children}
    </span>
  )
}
