import { FlaskConical } from 'lucide-react'
import { useState } from 'react'

import { useChannels, useDirectoryActions } from '../inbox/api.ts'
import { toast } from '../inbox/toasts.tsx'
import { Button, Dialog, Field } from '../inbox/ui.tsx'

function randomPhone() {
  return `+55119${String(Math.floor(Math.random() * 1e8)).padStart(8, '0')}`
}

/**
 * A test tool: a contact writing in on a fake channel, through the same webhook ingest a real
 * provider would hit.
 */
export function SimulateClient({ onOpenTicket }: { onOpenTicket: (ticketId: number) => void }) {
  const [open, setOpen] = useState(false)
  const channels = useChannels().data?.data ?? []
  const { simulate } = useDirectoryActions()
  const [channelId, setChannelId] = useState<number | null>(null)
  const [from, setFrom] = useState(randomPhone)
  const [name, setName] = useState('')
  const [text, setText] = useState('')
  const channel = channels.find(candidate => candidate.id === channelId) ?? channels[0]

  return (
    <>
      <Button
        size="sm"
        variant="test"
        data-testid="simulate"
        onClick={() => setOpen(true)}
        icon={<FlaskConical className="size-4" aria-hidden />}
      >
        Simular cliente
      </Button>
      <Dialog
        open={open}
        onClose={() => setOpen(false)}
        title="Simular mensagem de cliente"
        description="Envia uma mensagem como se um cliente tivesse escrito no canal."
        badge={
          <span className="shrink-0 rounded-md bg-amber-100 px-2 py-1 text-[11px] font-semibold tracking-wide text-amber-800 uppercase">
            Teste
          </span>
        }
      >
        <form
          data-testid="simulate-form"
          className="flex flex-col gap-4"
          onSubmit={event => {
            event.preventDefault()

            if (channel === undefined) return

            simulate.mutate(
              {
                params: { id: channel.id },
                body: { from, name: name.trim() === '' ? undefined : name.trim(), text },
              },
              {
                onSuccess: ({ ticketId }) => {
                  setOpen(false)
                  setText('')
                  setName('')
                  setFrom(randomPhone())

                  toast.success(
                    `Mensagem recebida em ${channel.name}.`,
                    ticketId === null
                      ? undefined
                      : { label: 'Abrir', run: () => onOpenTicket(ticketId) },
                  )
                },
              },
            )
          }}
        >
          <label className="block">
            <span className="mb-1.5 block text-[13px] font-medium text-slate-700">Canal</span>
            <select
              value={channel?.id ?? ''}
              onChange={event => setChannelId(Number(event.target.value))}
              className="h-10 w-full rounded-lg bg-white px-2 text-sm ring-1 ring-slate-200 ring-inset"
            >
              {channels.map(candidate => (
                <option key={candidate.id} value={candidate.id}>
                  {candidate.name} (fila {candidate.defaultQueue.name})
                </option>
              ))}
            </select>
          </label>
          <div className="grid grid-cols-2 gap-3">
            <Field
              label="Telefone"
              value={from}
              onChange={event => setFrom(event.target.value)}
              required
            />
            <Field
              label="Nome"
              value={name}
              onChange={event => setName(event.target.value)}
              placeholder="Opcional"
            />
          </div>
          <label className="block">
            <span className="mb-1.5 block text-[13px] font-medium text-slate-700">Mensagem</span>
            <textarea
              required
              rows={3}
              value={text}
              onChange={event => setText(event.target.value)}
              placeholder="Oi, preciso de ajuda com meu pedido"
              className="w-full resize-none rounded-lg px-3 py-2 text-sm ring-1 ring-slate-200 ring-inset focus:ring-2 focus:ring-brand-500 focus:outline-none"
            />
          </label>
          <div className="flex justify-end gap-2">
            <Button onClick={() => setOpen(false)}>Cancelar</Button>
            <Button type="submit" variant="primary" busy={simulate.isPending}>
              Enviar como cliente
            </Button>
          </div>
        </form>
      </Dialog>
    </>
  )
}
