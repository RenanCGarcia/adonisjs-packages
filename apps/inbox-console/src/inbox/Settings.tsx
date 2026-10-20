import type { Route } from '@tuyau/core/types'
import { Layers, Plus, Radio, UserRoundX, UsersRound } from 'lucide-react'
import { useState, type FormEvent, type ReactNode } from 'react'

import { useAgents, useChannels, useDirectoryActions, useQueues } from './api.ts'
import { toast } from './toasts.tsx'
import type { Agent, Queue } from './types.ts'
import { Avatar, Button, Chip, Dialog, Field } from './ui.tsx'

type Tab = 'agents' | 'queues'

const TABS: Record<Tab, { label: string; icon: ReactNode }> = {
  agents: { label: 'Agentes', icon: <UsersRound className="size-4" aria-hidden /> },
  queues: { label: 'Filas e canais', icon: <Layers className="size-4" aria-hidden /> },
}

// SAFETY: TABS is a Record<Tab, ...>, so its keys are exactly the tabs, in order.
const TAB_ORDER = Object.keys(TABS) as Tab[]

const FIELD_ERRORS = new Map([
  ['email.database.unique', 'Este e-mail já está em uso.'],
  ['email.email', 'Digite um e-mail válido.'],
  ['password.minLength', 'A senha precisa de pelo menos 8 caracteres.'],
  ['password.maxLength', 'A senha pode ter no máximo 32 caracteres.'],
  ['fullName.minLength', 'Digite o nome.'],
])

/**
 * pt-BR messages for a 422, keyed by field. A rule without its own sentence says the field is
 * invalid.
 */
function fieldErrors(
  error: Route.Error<'inbox.inbox_attendants.store'> | null,
): Record<string, string> {
  if (error === null || !error.isValidationError()) return {}

  return Object.fromEntries(
    error.response.errors.map(({ field, rule }) => [
      field,
      FIELD_ERRORS.get(`${field}.${rule}`) ?? 'Confira este campo.',
    ]),
  )
}

function QueueToggles({
  queues,
  selected,
  onToggle,
  busy = false,
}: {
  queues: Queue[]
  selected: ReadonlyArray<Queue['id']>
  onToggle: (queue: Queue) => void
  busy?: boolean
}) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {queues.map(queue => {
        const on = selected.includes(queue.id)

        return (
          <button
            key={queue.id}
            type="button"
            role="switch"
            aria-checked={on}
            disabled={busy}
            data-testid={`queue-toggle-${queue.name}`}
            onClick={() => onToggle(queue)}
            className={`rounded-full px-2.5 py-1 text-xs font-medium ring-1 transition-colors ring-inset disabled:opacity-60 ${on ? 'bg-brand-600 text-white ring-brand-600 hover:bg-brand-700' : 'bg-white text-slate-600 ring-slate-200 hover:ring-slate-300'}`}
          >
            {queue.name}
          </button>
        )
      })}
    </div>
  )
}

function NewAgent({ queues, onDone }: { queues: Queue[]; onDone: () => void }) {
  const { createAgent } = useDirectoryActions()
  const [queueIds, setQueueIds] = useState<Array<Queue['id']>>([])
  const [account, setAccount] = useState({ fullName: '', email: '', password: '' })
  const errors = fieldErrors(createAgent.error)

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()

    createAgent.mutate(
      { body: { ...account, queueIds } },
      {
        onSuccess: ({ data }) => {
          toast.success(`${data.name ?? data.email} já pode entrar no console.`)
          onDone()
        },
      },
    )
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-4" data-testid="new-agent">
      <Field
        label="Nome"
        name="fullName"
        value={account.fullName}
        onChange={event => setAccount({ ...account, fullName: event.target.value })}
        required
        error={errors.fullName}
        autoFocus
      />
      <Field
        label="E-mail"
        name="email"
        type="email"
        value={account.email}
        onChange={event => setAccount({ ...account, email: event.target.value })}
        required
        error={errors.email}
      />
      <Field
        label="Senha"
        name="password"
        type="password"
        value={account.password}
        onChange={event => setAccount({ ...account, password: event.target.value })}
        required
        error={errors.password}
        hint="De 8 a 32 caracteres. Passe para a pessoa por um canal seguro."
      />
      <div>
        <span className="mb-1.5 block text-[13px] font-medium text-slate-700">Filas</span>
        <QueueToggles
          queues={queues}
          selected={queueIds}
          onToggle={queue =>
            setQueueIds(
              queueIds.includes(queue.id)
                ? queueIds.filter(id => id !== queue.id)
                : [...queueIds, queue.id],
            )
          }
        />
      </div>
      <div className="mt-2 flex justify-end gap-2">
        <Button onClick={onDone}>Cancelar</Button>
        <Button type="submit" variant="primary" busy={createAgent.isPending}>
          Criar agente
        </Button>
      </div>
    </form>
  )
}

function AgentRow({
  agent,
  queues,
  onDeactivate,
}: {
  agent: Agent
  queues: Queue[]
  onDeactivate: () => void
}) {
  const { addMember, removeMember } = useDirectoryActions()
  const name = agent.name ?? agent.email

  return (
    <li
      data-testid="agent-row"
      className={`flex items-center gap-4 px-5 py-4 ${agent.active ? '' : 'opacity-60'}`}
    >
      <Avatar name={name} tone={agent.email} />
      <div className="w-56 min-w-0">
        <p className="truncate text-sm font-medium text-slate-900">{name}</p>
        <p className="truncate text-xs text-slate-500">{agent.email}</p>
      </div>
      <div className="flex-1">
        {agent.active ? (
          <QueueToggles
            queues={queues}
            busy={addMember.isPending || removeMember.isPending}
            selected={agent.queues.map(queue => queue.id)}
            onToggle={queue => {
              const params = { id: queue.id }
              const member = agent.queues.some(candidate => candidate.id === queue.id)

              if (member) removeMember.mutate({ params: { ...params, userId: agent.userId } })
              else addMember.mutate({ params, body: { userId: agent.userId } })
            }}
          />
        ) : (
          <Chip>Desativado</Chip>
        )}
      </div>
      <span className="w-28 text-right text-xs text-slate-500 tabular-nums">
        {agent.openTickets} em atendimento
      </span>
      {agent.active ? (
        <Button
          variant="ghost"
          size="sm"
          aria-label={`Desativar ${name}`}
          onClick={onDeactivate}
          icon={<UserRoundX className="size-4" aria-hidden />}
        >
          Desativar
        </Button>
      ) : (
        <span className="w-[6.5rem]" />
      )}
    </li>
  )
}

function Agents({ me }: { me: Agent | undefined }) {
  const agents = useAgents().data?.data ?? []
  const queues = useQueues().data?.data ?? []
  const { deactivate } = useDirectoryActions()
  const [creating, setCreating] = useState(false)
  const [leaving, setLeaving] = useState<Agent | null>(null)

  return (
    <>
      <div className="mb-4 flex items-end justify-between">
        <div>
          <h2 className="text-lg font-semibold text-slate-900">Agentes</h2>
          <p className="text-sm text-slate-500">
            Quem atende e em quais filas. Um agente só assume conversas das filas dele.
          </p>
        </div>
        <Button
          variant="primary"
          onClick={() => setCreating(true)}
          icon={<Plus className="size-4" aria-hidden />}
        >
          Novo agente
        </Button>
      </div>
      <ul className="divide-y divide-slate-100 rounded-xl bg-white shadow-sm ring-1 ring-slate-200">
        {agents.map(agent => (
          <AgentRow
            key={agent.id}
            agent={agent}
            queues={queues}
            onDeactivate={() => setLeaving(agent)}
          />
        ))}
      </ul>

      <Dialog
        open={creating}
        onClose={() => setCreating(false)}
        title="Novo agente"
        description="A pessoa entra com este e-mail e senha."
      >
        <NewAgent queues={queues} onDone={() => setCreating(false)} />
      </Dialog>

      <Dialog
        open={leaving !== null}
        onClose={() => setLeaving(null)}
        title={`Desativar ${leaving?.name ?? leaving?.email ?? ''}?`}
        description={
          leaving !== null && me !== undefined && leaving.id === me.id
            ? 'É você. Depois disso você não poderá mais atender.'
            : 'A pessoa deixa de receber e assumir conversas. As que estão com ela continuam abertas.'
        }
      >
        <div className="flex justify-end gap-2">
          <Button onClick={() => setLeaving(null)}>Cancelar</Button>
          <Button
            variant="danger"
            busy={deactivate.isPending}
            data-testid="confirm-deactivate"
            onClick={() => {
              if (leaving === null) return

              deactivate.mutate(
                { params: { userId: leaving.userId } },
                { onSuccess: () => setLeaving(null) },
              )
            }}
          >
            Desativar
          </Button>
        </div>
      </Dialog>
    </>
  )
}

function Queues() {
  const queues = useQueues().data?.data ?? []
  const channels = useChannels().data?.data ?? []
  const { createQueue, createChannel } = useDirectoryActions()
  const [queueName, setQueueName] = useState('')

  const [channel, setChannel] = useState<{ name: string; queueId: Queue['id'] | null }>({
    name: '',
    queueId: null,
  })

  return (
    <div className="grid grid-cols-2 gap-6">
      <section>
        <h2 className="text-lg font-semibold text-slate-900">Filas</h2>
        <p className="mb-4 text-sm text-slate-500">
          Cada conversa espera numa fila até alguém dela assumir.
        </p>
        <ul className="divide-y divide-slate-100 rounded-xl bg-white shadow-sm ring-1 ring-slate-200">
          {queues.map(queue => (
            <li key={queue.id} className="flex items-center gap-3 px-5 py-3.5">
              <Layers className="size-4 text-slate-400" aria-hidden />
              <span className="flex-1 text-sm font-medium text-slate-900">{queue.name}</span>
              <span className="text-xs text-slate-500 tabular-nums">
                {queue.queued} na fila · {queue.inProgress} em atendimento · {queue.members} pessoas
              </span>
            </li>
          ))}
          <li className="px-5 py-3.5">
            <form
              className="flex items-end gap-2"
              onSubmit={event => {
                event.preventDefault()
                createQueue.mutate(
                  { body: { name: queueName } },
                  {
                    onSuccess: () => {
                      toast.success(`Fila ${queueName} criada.`)
                      setQueueName('')
                    },
                  },
                )
              }}
            >
              <div className="flex-1">
                <Field
                  label="Nova fila"
                  value={queueName}
                  onChange={event => setQueueName(event.target.value)}
                  placeholder="Ex.: Financeiro"
                  required
                />
              </div>
              <Button
                type="submit"
                busy={createQueue.isPending}
                icon={<Plus className="size-4" aria-hidden />}
                size="lg"
              >
                Criar
              </Button>
            </form>
          </li>
        </ul>
      </section>

      <section>
        <h2 className="text-lg font-semibold text-slate-900">Canais</h2>
        <p className="mb-4 text-sm text-slate-500">
          Por onde os clientes escrevem, e em que fila caem.
        </p>
        <ul className="divide-y divide-slate-100 rounded-xl bg-white shadow-sm ring-1 ring-slate-200">
          {channels.map(candidate => (
            <li key={candidate.id} className="flex items-center gap-3 px-5 py-3.5">
              <Radio className="size-4 text-slate-400" aria-hidden />
              <span className="flex-1 text-sm font-medium text-slate-900">{candidate.name}</span>
              <Chip>{candidate.provider}</Chip>
              <span className="text-xs text-slate-500">→ {candidate.defaultQueue.name}</span>
            </li>
          ))}
          <li className="px-5 py-3.5">
            <form
              className="flex items-end gap-2"
              onSubmit={event => {
                event.preventDefault()

                if (channel.queueId === null) return

                createChannel.mutate(
                  { body: { name: channel.name, queueId: channel.queueId } },
                  {
                    onSuccess: () => {
                      toast.success(`Canal ${channel.name} criado.`)
                      setChannel({ name: '', queueId: null })
                    },
                  },
                )
              }}
            >
              <div className="flex-1">
                <Field
                  label="Novo canal de teste"
                  value={channel.name}
                  onChange={event => setChannel({ ...channel, name: event.target.value })}
                  placeholder="Ex.: Instagram"
                  required
                />
              </div>
              <label className="block">
                <span className="mb-1.5 block text-[13px] font-medium text-slate-700">Fila</span>
                <select
                  required
                  value={channel.queueId ?? ''}
                  onChange={event =>
                    setChannel({
                      ...channel,
                      queueId:
                        queues.find(queue => String(queue.id) === event.target.value)?.id ?? null,
                    })
                  }
                  className="h-10 rounded-lg bg-white px-2 text-sm ring-1 ring-slate-200 ring-inset"
                >
                  <option value="">Escolha</option>
                  {queues.map(queue => (
                    <option key={queue.id} value={queue.id}>
                      {queue.name}
                    </option>
                  ))}
                </select>
              </label>
              <Button
                type="submit"
                busy={createChannel.isPending}
                icon={<Plus className="size-4" aria-hidden />}
                size="lg"
              >
                Criar
              </Button>
            </form>
          </li>
        </ul>
      </section>
    </div>
  )
}

export function Settings({ me }: { me: Agent | undefined }) {
  const [tab, setTab] = useState<Tab>('agents')

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
      <div className="mx-auto w-full max-w-6xl px-8 py-8">
        <div
          role="tablist"
          aria-label="Ajustes"
          className="mb-8 inline-flex gap-1 rounded-xl bg-slate-200/70 p-1"
        >
          {TAB_ORDER.map(key => (
            <button
              key={key}
              type="button"
              role="tab"
              aria-selected={tab === key}
              onClick={() => setTab(key)}
              className={`flex items-center gap-2 rounded-lg px-3.5 py-1.5 text-sm font-medium transition-colors ${tab === key ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-600 hover:text-slate-900'}`}
            >
              {TABS[key].icon}
              {TABS[key].label}
            </button>
          ))}
        </div>
        {tab === 'agents' ? <Agents me={me} /> : <Queues />}
      </div>
    </div>
  )
}
