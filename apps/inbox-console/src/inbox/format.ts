import { useEffect, useState } from 'react'

const relative = new Intl.RelativeTimeFormat('pt-BR', { style: 'short', numeric: 'auto' })

const STEPS: Array<[Intl.RelativeTimeFormatUnit, number]> = [
  ['second', 60],
  ['minute', 60],
  ['hour', 24],
  ['day', 7],
  ['week', 4.35],
  ['month', 12],
  ['year', Number.POSITIVE_INFINITY],
]

/**
 * "agora", "há 2 min", "ontem": how long ago `iso` was, as an attendant reads it.
 */
export function ago(iso: string | null, now: number) {
  if (iso === null) return ''

  let amount = (Date.parse(iso) - now) / 1000

  if (amount > -45) return 'agora'

  for (const [unit, size] of STEPS) {
    if (Math.abs(amount) < size) return relative.format(Math.round(amount), unit).replace(/\.$/, '')

    amount /= size
  }

  return relative.format(Math.round(amount), 'year')
}

const clock = new Intl.DateTimeFormat('pt-BR', { hour: '2-digit', minute: '2-digit' })

const dated = new Intl.DateTimeFormat('pt-BR', {
  day: '2-digit',
  month: 'short',
  hour: '2-digit',
  minute: '2-digit',
})

export function timeOf(iso: string | null) {
  return iso === null ? '' : clock.format(new Date(iso))
}

export function dateTimeOf(iso: string | null) {
  return iso === null ? '' : dated.format(new Date(iso))
}

/**
 * The current time, ticking often enough for `ago` to stay right.
 */
export function useNow(everyMs = 30_000) {
  const [now, setNow] = useState(Date.now)

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), everyMs)

    return () => clearInterval(timer)
  }, [everyMs])

  return now
}

export function initials(name: string) {
  const words = name
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .split(/\s+/)
    .filter(Boolean)

  if (words.length === 0) return '?'

  const first = words[0]!.charAt(0)
  const last = words.length > 1 ? words.at(-1)!.charAt(0) : (words[0]!.charAt(1) ?? '')

  return (first + last).toUpperCase()
}

const AVATAR_TONES = [
  'bg-rose-100 text-rose-700',
  'bg-amber-100 text-amber-800',
  'bg-emerald-100 text-emerald-700',
  'bg-sky-100 text-sky-700',
  'bg-violet-100 text-violet-700',
  'bg-teal-100 text-teal-700',
  'bg-fuchsia-100 text-fuchsia-700',
  'bg-lime-100 text-lime-800',
  'bg-orange-100 text-orange-700',
  'bg-indigo-100 text-indigo-700',
]

/**
 * The same person always gets the same avatar color.
 */
export function toneOf(key: string) {
  let hash = 0

  for (const char of key) hash = (hash * 31 + char.charCodeAt(0)) >>> 0

  return AVATAR_TONES[hash % AVATAR_TONES.length]!
}

export function contactName(contact: { name: string | null; address: string }) {
  return contact.name ?? contact.address
}
