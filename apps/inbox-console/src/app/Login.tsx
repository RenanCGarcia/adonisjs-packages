import { TuyauError } from '@tuyau/core/client'
import { MessagesSquare } from 'lucide-react'
import { useState } from 'react'

import { describeFailure } from '../inbox/messages.ts'
import { Button, Field } from '../inbox/ui.tsx'
import { client } from './client.ts'
import { sessions } from './sessions.ts'

const SEEDED = ['ana', 'bruno', 'carla', 'diego', 'elisa', 'felipe'].map(
  name => `${name}@inbox.test`,
)

const SEEDED_PASSWORD = 'inbox-password'

/**
 * Signs an agent in and keeps the session. `email` fixes the account when switching to an
 * agent who has no token on this browser yet.
 */
export function SignInForm({ email: fixed, onDone }: { email?: string; onDone?: () => void }) {
  const [email, setEmail] = useState(fixed ?? '')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  return (
    <form
      data-testid="login-form"
      className="flex flex-col gap-4"
      onSubmit={async event => {
        event.preventDefault()
        setBusy(true)
        setError(null)

        const [response, failure] = await client.api.auth.accessTokens
          .store({ body: { email, password } })
          .safe()

        setBusy(false)

        if (failure !== null) {
          const wrongCredentials =
            failure instanceof TuyauError && (failure.status === 400 || failure.status === 422)

          setError(wrongCredentials ? 'E-mail ou senha incorretos.' : describeFailure(failure))

          return
        }

        sessions.signIn(response.data)
        onDone?.()
      }}
    >
      <Field
        label="E-mail"
        type="email"
        name="email"
        autoComplete="username"
        value={email}
        readOnly={fixed !== undefined}
        onChange={event => setEmail(event.target.value)}
        required
      />
      <Field
        label="Senha"
        type="password"
        name="password"
        autoComplete="current-password"
        value={password}
        onChange={event => setPassword(event.target.value)}
        autoFocus={fixed !== undefined}
        required
      />
      {error !== null && (
        <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </p>
      )}
      <Button type="submit" variant="primary" busy={busy} size="lg">
        Entrar
      </Button>
      {fixed === undefined && (
        <aside className="mt-2 rounded-xl border border-dashed border-amber-300 bg-amber-50/70 p-3.5 text-xs text-amber-900">
          <p className="font-semibold">Ambiente de testes</p>
          <p className="mt-0.5 text-amber-800">
            Contas do <code className="font-mono">inbox:seed</code>. Clique para preencher.
          </p>
          <div className="mt-2.5 flex flex-wrap gap-1.5">
            {SEEDED.map(candidate => (
              <button
                key={candidate}
                type="button"
                onClick={() => {
                  setEmail(candidate)
                  setPassword(SEEDED_PASSWORD)
                }}
                className="rounded-md bg-white px-2 py-1 font-mono text-[11px] text-amber-900 ring-1 ring-amber-200 hover:ring-amber-400"
              >
                {candidate.split('@')[0]}
              </button>
            ))}
          </div>
        </aside>
      )}
    </form>
  )
}

export function Login() {
  return (
    <main className="flex min-h-full items-center justify-center bg-gradient-to-b from-slate-100 to-slate-200/60 p-6">
      <div className="w-full max-w-sm">
        <div className="mb-8 flex flex-col items-center gap-3 text-center">
          <span className="flex size-12 items-center justify-center rounded-2xl bg-brand-600 text-white shadow-lg shadow-brand-600/30">
            <MessagesSquare className="size-6" aria-hidden />
          </span>
          <div>
            <h1 className="text-xl font-semibold text-slate-900">Entrar no atendimento</h1>
            <p className="mt-1 text-sm text-slate-500">Use o e-mail e a senha da sua conta.</p>
          </div>
        </div>
        <div className="rounded-2xl bg-white p-6 shadow-xl ring-1 shadow-slate-900/5 ring-slate-200">
          <SignInForm />
        </div>
      </div>
    </main>
  )
}
