import { useDeferredValue, useEffect, useState } from 'react'

import {
  useAgents,
  useChannels,
  useQueues,
  useTicket,
  useTicketActions,
  useTicketList,
} from './api.ts'
import { CLOSE_REASONS, VIEW_EMPTY, VIEW_LABELS } from './messages.ts'
import { Nav } from './Nav.tsx'
import { postureOf } from './posture.ts'
import { Sidebar } from './Sidebar.tsx'
import { NoThread, Thread } from './Thread.tsx'
import { TicketList } from './TicketList.tsx'
import { toast } from './toasts.tsx'
import type { Agent, Channel, CloseReason, Queue, Selection, TicketDetail } from './types.ts'
import { Button, Dialog } from './ui.tsx'

// SAFETY: CLOSE_REASONS is a Record<CloseReason, ...>, so its keys are exactly the reasons.
const AGENT_REASONS = (Object.keys(CLOSE_REASONS) as CloseReason[]).filter(
  reason => CLOSE_REASONS[reason].agent,
)

function ResolveDialog({
  open,
  onClose,
  onConfirm,
}: {
  open: boolean
  onClose: () => void
  onConfirm: (reason: CloseReason, note: string) => Promise<boolean>
}) {
  const [reason, setReason] = useState<CloseReason>('manual')
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Resolver conversa"
      description="O cliente pode escrever de novo depois. Uma nova conversa será aberta."
    >
      <form
        onSubmit={event => {
          event.preventDefault()
          setBusy(true)
          void onConfirm(reason, note.trim()).then(done => {
            setBusy(false)

            if (done) {
              setNote('')
              onClose()
            }
          })
        }}
      >
        <fieldset className="flex flex-col gap-2">
          <legend className="mb-2 text-[13px] font-medium text-slate-700">Motivo</legend>
          {AGENT_REASONS.map(candidate => (
            <label
              key={candidate}
              className={`flex cursor-pointer items-center gap-3 rounded-lg px-3 py-2.5 text-sm ring-1 ring-inset ${reason === candidate ? 'bg-brand-50 ring-brand-500' : 'ring-slate-200 hover:bg-slate-50'}`}
            >
              <input
                type="radio"
                name="reason"
                value={candidate}
                checked={reason === candidate}
                onChange={() => setReason(candidate)}
                className="accent-brand-600"
              />
              {CLOSE_REASONS[candidate].label}
            </label>
          ))}
        </fieldset>
        <label className="mt-4 block">
          <span className="mb-1.5 block text-[13px] font-medium text-slate-700">
            Observação <span className="font-normal text-slate-400">(opcional)</span>
          </span>
          <textarea
            value={note}
            onChange={event => setNote(event.target.value)}
            rows={2}
            className="w-full resize-none rounded-lg px-3 py-2 text-sm ring-1 ring-slate-200 ring-inset focus:ring-2 focus:ring-brand-500 focus:outline-none"
          />
        </label>
        <div className="mt-6 flex justify-end gap-2">
          <Button onClick={onClose}>Cancelar</Button>
          <Button type="submit" variant="primary" busy={busy} data-testid="confirm-resolve">
            Resolver
          </Button>
        </div>
      </form>
    </Dialog>
  )
}

function OpenTicket({
  ticket,
  me,
  agents,
  queues,
}: {
  ticket: TicketDetail
  me: Agent | undefined
  agents: Agent[]
  queues: Queue[]
}) {
  const actions = useTicketActions(ticket.id)
  const [sidebarOpen, setSidebarOpen] = useState(true)
  const [resolving, setResolving] = useState(false)
  const posture = postureOf(ticket, me)
  const { markRead } = actions

  useEffect(() => {
    if (posture.kind === 'mine' && ticket.unreadCount > 0) markRead()
  }, [posture.kind, ticket.id, ticket.unreadCount, markRead])

  const agentName = (userId: number) =>
    agents.find(agent => agent.userId === userId)?.name ?? 'o agente'

  const queueName = (queueId: number) =>
    queues.find(queue => queue.id === queueId)?.name ?? 'a fila'

  return (
    <>
      <Thread
        ticket={ticket}
        me={me}
        agents={agents}
        queues={queues}
        posture={posture}
        replying={actions.replying}
        pending={actions.pending}
        sidebarOpen={sidebarOpen}
        onToggleSidebar={() => setSidebarOpen(!sidebarOpen)}
        onAssume={() => {
          void actions
            .assume()
            .then(
              done => done && toast.success('Conversa assumida. Ela está em "Minhas conversas".'),
            )
        }}
        onResolve={() => setResolving(true)}
        onSend={actions.reply}
      />
      {sidebarOpen && (
        <Sidebar
          ticket={ticket}
          posture={posture}
          me={me}
          agents={agents}
          queues={queues}
          pending={actions.pending}
          onAssign={userId => {
            void actions
              .assign(userId)
              .then(done => done && toast.success(`Conversa atribuída a ${agentName(userId)}.`))
          }}
          onTransfer={queueId => {
            void actions
              .transfer(queueId)
              .then(
                done => done && toast.success(`Conversa transferida para ${queueName(queueId)}.`),
              )
          }}
          onGiveBack={() => {
            void actions
              .giveBack()
              .then(done => done && toast.success('Conversa devolvida à fila.'))
          }}
          onResolve={() => setResolving(true)}
        />
      )}
      <ResolveDialog
        open={resolving}
        onClose={() => setResolving(false)}
        onConfirm={async (reason, note) => {
          const done = await actions.resolve(reason, note === '' ? undefined : note)

          if (done) toast.success('Conversa resolvida.')

          return done
        }}
      />
    </>
  )
}

export function Inbox({
  me,
  ticketId,
  onOpenTicket,
}: {
  me: Agent | undefined
  ticketId: number | null
  onOpenTicket: (ticketId: number | null) => void
}) {
  const [selection, setSelection] = useState<Selection>({ kind: 'view', view: 'mine' })
  const [channelId, setChannelId] = useState<Channel['id'] | null>(null)
  const [search, setSearch] = useState('')
  const deferredSearch = useDeferredValue(search)

  const list = useTicketList({ selection, channelId, search: deferredSearch })
  const ticket = useTicket(ticketId)
  const agents = useAgents().data?.data ?? []
  const queues = useQueues().data?.data ?? []
  const channels = useChannels().data?.data ?? []

  const queueName =
    selection.kind === 'queue'
      ? queues.find(queue => queue.id === selection.queueId)?.name
      : undefined

  const empty =
    selection.kind === 'view'
      ? VIEW_EMPTY[selection.view]
      : `Nenhuma conversa aberta na fila ${queueName ?? ''}.`

  const shown = ticket.data?.data.id === ticketId ? ticket.data?.data : undefined

  return (
    <div className="flex min-h-0 flex-1">
      <div className="w-60 shrink-0 border-r border-slate-200 bg-slate-100/80">
        <Nav
          selection={selection}
          onSelect={setSelection}
          views={list.data?.views}
          queueCounts={list.data?.queues}
          queues={queues}
        />
      </div>
      <div className="flex w-[22rem] shrink-0 flex-col">
        <div className="flex h-12 shrink-0 items-center border-r border-b border-slate-200 bg-white px-4">
          <h2 data-testid="list-title" className="text-sm font-semibold text-slate-900">
            {selection.kind === 'view' ? VIEW_LABELS[selection.view] : `Fila ${queueName ?? ''}`}
          </h2>
          {list.data !== undefined && (
            <span className="ml-2 text-xs text-slate-400 tabular-nums">
              {list.data.metadata.total}
            </span>
          )}
        </div>
        <TicketList
          rows={list.data?.data}
          loading={list.isLoading}
          me={me}
          selectedId={ticketId}
          onOpen={onOpenTicket}
          empty={empty}
          search={search}
          onSearch={setSearch}
          channels={channels}
          channelId={channelId}
          onChannel={setChannelId}
        />
      </div>
      {ticketId === null && (
        <NoThread>Escolha uma conversa à esquerda para ver as mensagens.</NoThread>
      )}
      {ticketId !== null && shown === undefined && ticket.isError && (
        <NoThread>Não encontramos esta conversa.</NoThread>
      )}
      {ticketId !== null && shown === undefined && !ticket.isError && (
        <NoThread>Carregando conversa…</NoThread>
      )}
      {shown !== undefined && (
        <OpenTicket key={shown.id} ticket={shown} me={me} agents={agents} queues={queues} />
      )}
    </div>
  )
}
