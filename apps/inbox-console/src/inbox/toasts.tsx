import { CircleAlert, CircleCheck, X } from 'lucide-react'
import { useSyncExternalStore } from 'react'

type Tone = 'error' | 'success'

interface Toast {
  id: number
  tone: Tone
  text: string
  action?: { label: string; run: () => void }
}

const SHOWN_MS = 6000

let toasts: Toast[] = []
let nextId = 1
const listeners = new Set<() => void>()

function publish(next: Toast[]) {
  toasts = next

  for (const listener of listeners) listener()
}

function dismiss(id: number) {
  publish(toasts.filter(toast => toast.id !== id))
}

function push(tone: Tone, text: string, action?: Toast['action']) {
  const id = nextId++

  // The same sentence twice in a row (a poll racing a click) shows once.
  publish([...toasts.filter(toast => toast.text !== text), { id, tone, text, action }].slice(-3))
  setTimeout(() => dismiss(id), SHOWN_MS)
}

export const toast = {
  error: (text: string) => push('error', text),
  success: (text: string, action?: Toast['action']) => push('success', text, action),
}

function subscribe(listener: () => void) {
  listeners.add(listener)

  return () => {
    listeners.delete(listener)
  }
}

const TONES: Record<Tone, { icon: typeof CircleAlert; className: string }> = {
  error: { icon: CircleAlert, className: 'text-red-400' },
  success: { icon: CircleCheck, className: 'text-emerald-400' },
}

export function Toaster() {
  const shown = useSyncExternalStore(subscribe, () => toasts)

  return (
    <div
      aria-live="polite"
      className="pointer-events-none fixed top-16 right-4 z-50 flex w-96 flex-col gap-2"
    >
      {shown.map(({ id, tone, text, action }) => {
        const { icon: Icon, className } = TONES[tone]

        return (
          <div
            key={id}
            role={tone === 'error' ? 'alert' : 'status'}
            data-testid="toast"
            className="pointer-events-auto flex w-full max-w-md animate-[toast-in_160ms_ease-out] items-start gap-3 rounded-xl bg-slate-900 px-4 py-3 text-sm text-white shadow-lg shadow-slate-900/20"
          >
            <Icon className={`mt-0.5 size-4 shrink-0 ${className}`} aria-hidden />
            <p className="flex-1 leading-5">{text}</p>
            {action !== undefined && (
              <button
                type="button"
                className="font-semibold text-brand-200 hover:text-white"
                onClick={() => {
                  action.run()
                  dismiss(id)
                }}
              >
                {action.label}
              </button>
            )}
            <button
              type="button"
              aria-label="Fechar aviso"
              className="text-slate-400 hover:text-white"
              onClick={() => dismiss(id)}
            >
              <X className="size-4" aria-hidden />
            </button>
          </div>
        )
      })}
    </div>
  )
}
