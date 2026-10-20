import { ArrowLeft, LogOut, MessagesSquare, Settings as Gear } from 'lucide-react'
import { useEffect, useState, useSyncExternalStore } from 'react'

import { useAgents } from '../inbox/api.ts'
import { Inbox } from '../inbox/Inbox.tsx'
import { Settings } from '../inbox/Settings.tsx'
import { Toaster } from '../inbox/toasts.tsx'
import type { Agent } from '../inbox/types.ts'
import { Avatar, Button, Dialog, Menu } from '../inbox/ui.tsx'
import { queryClient } from './client.ts'
import { Login, SignInForm } from './Login.tsx'
import { sessions, useSessions, type Session } from './sessions.ts'
import { SimulateClient } from './SimulateClient.tsx'

/**
 * `#/conversas/12` opens a conversation and `#/ajustes` the settings, so a reload keeps the
 * agent where they were.
 */
type Route = { screen: 'inbox'; ticketId: number | null } | { screen: 'settings' }

function parse(hash: string): Route {
  if (hash === '#/ajustes') return { screen: 'settings' }

  const ticket = /^#\/conversas\/(\d+)$/.exec(hash)

  return { screen: 'inbox', ticketId: ticket === null ? null : Number(ticket[1]) }
}

function hrefOf(route: Route) {
  if (route.screen === 'settings') return '#/ajustes'

  return route.ticketId === null ? '#/' : `#/conversas/${route.ticketId}`
}

function subscribeToHash(listener: () => void) {
  window.addEventListener('hashchange', listener)

  return () => window.removeEventListener('hashchange', listener)
}

function useRoute() {
  const hash = useSyncExternalStore(subscribeToHash, () => window.location.hash)

  return [parse(hash), (route: Route) => (window.location.hash = hrefOf(route))] as const
}

function ActingAs({ session, agents }: { session: Session; agents: Agent[] }) {
  const [asking, setAsking] = useState<string | null>(null)
  const name = session.user.fullName ?? session.user.email

  const switchTo = (email: string) => {
    if (email === session.user.email) return

    if (!sessions.has(email)) {
      setAsking(email)

      return
    }

    queryClient.clear()
    sessions.switchTo(email)
  }

  return (
    <>
      <Menu
        label="Atuando como"
        testId="acting-as"
        align="right"
        onPick={switchTo}
        trigger={
          <span className="flex items-center gap-2.5 rounded-lg py-1 pr-2.5 pl-1 hover:bg-slate-100">
            <Avatar name={name} tone={session.user.email} size="sm" />
            <span className="text-left leading-tight">
              <span className="block text-[10px] font-medium tracking-wide text-slate-400 uppercase">
                Atuando como
              </span>
              <span
                data-testid="acting-as-name"
                className="block text-[13px] font-semibold text-slate-800"
              >
                {name}
              </span>
            </span>
          </span>
        }
        options={agents
          .filter(agent => agent.active)
          .map(agent => ({
            value: agent.email,
            label: agent.name ?? agent.email,
            detail: sessions.has(agent.email) ? agent.email : `${agent.email} · pede a senha`,
            icon: <Avatar name={agent.name ?? agent.email} tone={agent.email} size="sm" />,
            selected: agent.email === session.user.email,
          }))}
      />
      <Dialog
        open={asking !== null}
        onClose={() => setAsking(null)}
        title="Entrar como outro agente"
        description="Esta pessoa ainda não entrou neste navegador. Digite a senha dela."
      >
        {asking !== null && (
          <SignInForm
            email={asking}
            onDone={() => {
              queryClient.clear()
              setAsking(null)
            }}
          />
        )}
      </Dialog>
    </>
  )
}

function Shell({ session }: { session: Session }) {
  const [route, navigate] = useRoute()
  const agents = useAgents().data?.data ?? []
  const me = agents.find(agent => agent.userId === session.user.id)

  useEffect(() => {
    document.title = route.screen === 'settings' ? 'Ajustes · Inbox' : 'Inbox'
  }, [route.screen])

  return (
    <div className="flex h-full min-w-[1024px] flex-col">
      <header className="flex h-14 shrink-0 items-center gap-3 border-b border-slate-200 bg-white px-4">
        <a href="#/" className="flex items-center gap-2.5 pr-4">
          <span className="flex size-8 items-center justify-center rounded-lg bg-brand-600 text-white">
            <MessagesSquare className="size-4" aria-hidden />
          </span>
          <span className="text-[15px] font-semibold tracking-tight text-slate-900">Inbox</span>
        </a>
        {route.screen === 'settings' && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => navigate({ screen: 'inbox', ticketId: null })}
            icon={<ArrowLeft className="size-4" aria-hidden />}
          >
            Voltar às conversas
          </Button>
        )}
        <div className="flex-1" />
        <SimulateClient onOpenTicket={ticketId => navigate({ screen: 'inbox', ticketId })} />
        <Button
          variant="ghost"
          aria-label="Ajustes"
          aria-pressed={route.screen === 'settings'}
          data-testid="settings"
          onClick={() =>
            navigate(
              route.screen === 'settings'
                ? { screen: 'inbox', ticketId: null }
                : { screen: 'settings' },
            )
          }
          icon={<Gear className="size-4" aria-hidden />}
          size="icon"
        />
        <span className="h-6 w-px bg-slate-200" />
        <ActingAs session={session} agents={agents} />
        <Button
          variant="ghost"
          aria-label="Sair"
          title="Sair"
          onClick={() => {
            queryClient.clear()
            sessions.signOut(session.user.email)
          }}
          icon={<LogOut className="size-4" aria-hidden />}
          size="icon"
        />
      </header>
      {route.screen === 'settings' ? (
        <Settings me={me} />
      ) : (
        <Inbox
          me={me}
          ticketId={route.ticketId}
          onOpenTicket={ticketId => navigate({ screen: 'inbox', ticketId })}
        />
      )}
    </div>
  )
}

export function App() {
  const state = useSessions()
  const session = state.current === null ? null : (state.byEmail[state.current] ?? null)

  return (
    <>
      {session === null ? <Login /> : <Shell key={session.user.email} session={session} />}
      <Toaster />
    </>
  )
}
