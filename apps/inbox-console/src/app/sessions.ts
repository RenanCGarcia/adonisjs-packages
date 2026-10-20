import type { Route } from '@tuyau/core/types'
import { useSyncExternalStore } from 'react'

export type User = Route.Response<'auth.access_tokens.store'>['data']['user']

export interface Session {
  token: string
  user: User
}

/**
 * Every agent signed in on this browser, so "Atuando como" switches without asking for the
 * password again. `current` is the email of the agent the console acts as.
 */
interface Sessions {
  current: string | null
  byEmail: Record<string, Session>
}

const KEY = 'inbox-console.sessions'

function load(): Sessions {
  try {
    const stored = localStorage.getItem(KEY)

    if (stored !== null) {
      // SAFETY: only `persist` writes this key, with a Sessions value.
      return JSON.parse(stored) as Sessions
    }
  } catch {
    // Storage can be blocked, or hold a value from an older build. Start signed out.
  }

  return { current: null, byEmail: {} }
}

let state = load()
const listeners = new Set<() => void>()

function persist(next: Sessions) {
  state = next

  try {
    localStorage.setItem(KEY, JSON.stringify(next))
  } catch {
    // Without storage the sessions last until the tab closes.
  }

  for (const listener of listeners) listener()
}

export const sessions = {
  current(): Session | null {
    return state.current === null ? null : (state.byEmail[state.current] ?? null)
  },

  has(email: string) {
    return email in state.byEmail
  },

  signIn(session: Session) {
    persist({
      current: session.user.email,
      byEmail: { ...state.byEmail, [session.user.email]: session },
    })
  },

  switchTo(email: string) {
    if (email in state.byEmail) persist({ ...state, current: email })
  },

  signOut(email: string) {
    const { [email]: _signedOut, ...byEmail } = state.byEmail

    persist({ current: state.current === email ? null : state.current, byEmail })
  },
}

function subscribe(listener: () => void) {
  listeners.add(listener)

  return () => {
    listeners.delete(listener)
  }
}

function snapshot() {
  return state
}

export function useSessions() {
  return useSyncExternalStore(subscribe, snapshot)
}
