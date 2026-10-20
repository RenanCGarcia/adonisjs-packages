import { Check, ChevronDown, LoaderCircle } from 'lucide-react'
import {
  useEffect,
  useId,
  useRef,
  useState,
  type ButtonHTMLAttributes,
  type InputHTMLAttributes,
  type ReactNode,
} from 'react'

import { initials, toneOf } from './format.ts'

const BUTTON_VARIANTS = {
  primary:
    'bg-brand-600 text-white shadow-sm shadow-brand-600/20 hover:bg-brand-700 disabled:bg-brand-600/50',
  secondary:
    'bg-white text-slate-700 ring-1 ring-slate-200 ring-inset hover:bg-slate-50 hover:ring-slate-300 disabled:text-slate-400',
  ghost: 'text-slate-600 hover:bg-slate-100 hover:text-slate-900 disabled:text-slate-300',
  danger: 'bg-white text-red-600 ring-1 ring-red-200 ring-inset hover:bg-red-50',
  test: 'bg-amber-50 text-amber-800 ring-1 ring-amber-200 ring-inset hover:bg-amber-100 hover:ring-amber-300',
}

const BUTTON_SIZES = {
  sm: 'h-8 gap-1.5 px-2.5 text-[13px]',
  md: 'h-9 gap-2 px-3.5 text-sm',
  lg: 'h-10 gap-2 px-4 text-sm',
  icon: 'size-9',
}

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: keyof typeof BUTTON_VARIANTS
  size?: keyof typeof BUTTON_SIZES
  busy?: boolean
  icon?: ReactNode
}

export function Button({
  variant = 'secondary',
  size = 'md',
  busy = false,
  icon,
  className = '',
  children,
  disabled,
  ...props
}: ButtonProps) {
  return (
    <button
      type="button"
      disabled={disabled === true || busy}
      className={`inline-flex shrink-0 items-center justify-center rounded-lg font-medium transition-colors disabled:cursor-not-allowed ${BUTTON_SIZES[size]} ${BUTTON_VARIANTS[variant]} ${className}`}
      {...props}
    >
      {busy ? <LoaderCircle className="size-4 animate-spin" aria-hidden /> : icon}
      {children}
    </button>
  )
}

export function Avatar({
  name,
  tone = name,
  size = 'md',
}: {
  name: string
  tone?: string
  size?: 'sm' | 'md' | 'lg'
}) {
  const sizing = { sm: 'size-6 text-[10px]', md: 'size-9 text-xs', lg: 'size-12 text-base' }[size]

  return (
    <span
      aria-hidden
      className={`inline-flex shrink-0 items-center justify-center rounded-full font-semibold ${sizing} ${toneOf(tone)}`}
    >
      {initials(name)}
    </span>
  )
}

const CHIP_TONES = {
  neutral: 'bg-slate-100 text-slate-600',
  amber: 'bg-amber-50 text-amber-700 ring-1 ring-amber-200/60 ring-inset',
  violet: 'bg-violet-50 text-violet-700 ring-1 ring-violet-200/60 ring-inset',
  sky: 'bg-sky-50 text-sky-700 ring-1 ring-sky-200/60 ring-inset',
  emerald: 'bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200/60 ring-inset',
}

export type ChipTone = keyof typeof CHIP_TONES

export function Chip({ children, tone = 'neutral' }: { children: ReactNode; tone?: ChipTone }) {
  return (
    <span
      className={`inline-flex max-w-full items-center gap-1 truncate rounded-md px-1.5 py-0.5 text-[11px] font-medium ${CHIP_TONES[tone]}`}
    >
      {children}
    </span>
  )
}

export function Skeleton({ className = '' }: { className?: string }) {
  return <span className={`block animate-pulse rounded bg-slate-200/80 ${className}`} />
}

/**
 * A modal on the native `<dialog>`, which traps focus and closes on Escape by itself.
 */
export function Dialog({
  open,
  onClose,
  title,
  description,
  badge,
  children,
  width = 'max-w-md',
}: {
  open: boolean
  onClose: () => void
  title: string
  description?: string
  badge?: ReactNode
  children: ReactNode
  width?: string
}) {
  const ref = useRef<HTMLDialogElement>(null)
  const titleId = useId()

  useEffect(() => {
    const dialog = ref.current

    if (dialog === null) return

    if (open && !dialog.open) dialog.showModal()

    if (!open && dialog.open) dialog.close()
  }, [open])

  return (
    <dialog
      ref={ref}
      aria-labelledby={titleId}
      onClose={onClose}
      onClick={event => {
        if (event.target === ref.current) onClose()
      }}
      className={`m-auto w-[calc(100%-2rem)] ${width} rounded-2xl bg-white p-0 text-slate-900 shadow-2xl shadow-slate-900/20`}
    >
      {open && (
        <div className="p-6">
          <div className="mb-5 flex items-start justify-between gap-4">
            <div>
              <h2 id={titleId} className="text-base font-semibold">
                {title}
              </h2>
              {description !== undefined && (
                <p className="mt-1 text-sm text-slate-500">{description}</p>
              )}
            </div>
            {badge}
          </div>
          {children}
        </div>
      )}
    </dialog>
  )
}

export function Field({
  label,
  error,
  hint,
  ...props
}: InputHTMLAttributes<HTMLInputElement> & { label: string; error?: string; hint?: string }) {
  const id = useId()
  const note = error ?? hint

  return (
    <div>
      <label htmlFor={id} className="mb-1.5 block text-[13px] font-medium text-slate-700">
        {label}
      </label>
      <input
        id={id}
        aria-invalid={error !== undefined}
        aria-describedby={note === undefined ? undefined : `${id}-note`}
        className={`h-10 w-full rounded-lg bg-white px-3 text-sm ring-1 ring-inset placeholder:text-slate-400 focus:ring-2 focus:ring-brand-500 focus:outline-none ${error === undefined ? 'ring-slate-200' : 'ring-red-300'}`}
        {...props}
      />
      {note !== undefined && (
        <p
          id={`${id}-note`}
          className={`mt-1 text-xs ${error === undefined ? 'text-slate-500' : 'text-red-600'}`}
        >
          {note}
        </p>
      )}
    </div>
  )
}

export interface MenuOption<Value> {
  value: Value
  label: string
  detail?: string
  icon?: ReactNode
  selected?: boolean
  disabled?: boolean
}

export function Menu<Value>({
  label,
  options,
  onPick,
  trigger,
  align = 'left',
  empty = 'Nada para escolher.',
  testId,
}: {
  label: string
  options: Array<MenuOption<Value>>
  onPick: (value: Value) => void
  trigger?: ReactNode
  align?: 'left' | 'right'
  empty?: string
  testId?: string
}) {
  const [open, setOpen] = useState(false)
  const root = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return

    const close = (event: MouseEvent | KeyboardEvent) => {
      const outside = event.target instanceof Node && !root.current?.contains(event.target)

      if (event instanceof KeyboardEvent ? event.key === 'Escape' : outside) setOpen(false)
    }

    document.addEventListener('mousedown', close)
    document.addEventListener('keydown', close)

    return () => {
      document.removeEventListener('mousedown', close)
      document.removeEventListener('keydown', close)
    }
  }, [open])

  return (
    <div ref={root} className="relative">
      <button
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open}
        data-testid={testId}
        onClick={() => setOpen(!open)}
        className="w-full"
      >
        {trigger ?? (
          <span className="flex h-9 items-center justify-between gap-2 rounded-lg bg-white px-3 text-sm text-slate-700 ring-1 ring-slate-200 ring-inset hover:ring-slate-300">
            {label}
            <ChevronDown className="size-4 text-slate-400" aria-hidden />
          </span>
        )}
      </button>
      {open && (
        <ul
          role="listbox"
          aria-label={label}
          className={`absolute z-30 mt-1.5 max-h-72 w-64 overflow-y-auto rounded-xl bg-white p-1.5 shadow-xl ring-1 shadow-slate-900/10 ring-slate-200 ${align === 'right' ? 'right-0' : 'left-0'}`}
        >
          {options.length === 0 && <li className="px-3 py-2 text-sm text-slate-500">{empty}</li>}
          {options.map(option => (
            <li key={String(option.value)}>
              <button
                type="button"
                role="option"
                aria-selected={option.selected === true}
                disabled={option.disabled}
                onClick={() => {
                  setOpen(false)
                  onPick(option.value)
                }}
                className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-sm text-slate-700 hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {option.icon}
                <span className="min-w-0 flex-1">
                  <span className="block truncate">{option.label}</span>
                  {option.detail !== undefined && (
                    <span className="block truncate text-xs text-slate-500">{option.detail}</span>
                  )}
                </span>
                {option.selected === true && (
                  <Check className="size-4 text-brand-600" aria-hidden />
                )}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
