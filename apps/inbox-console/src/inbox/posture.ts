import type { Agent, TicketRow } from './types.ts'

/**
 * Where a ticket stands for the agent looking at it. Everything the thread offers (the header
 * action, the composer, the sidebar controls) follows from this one value.
 */
export type Posture =
  | { kind: 'queued' }
  | { kind: 'mine' }
  | { kind: 'bot'; bot: string }
  | { kind: 'other'; holder: string }
  | { kind: 'outsider'; queue: string }
  | { kind: 'closed' }

export function postureOf(ticket: TicketRow, me: Agent | undefined): Posture {
  if (ticket.status === 'closed') return { kind: 'closed' }

  const { assignee } = ticket

  if (assignee !== null && me !== undefined && assignee.id === me.id) return { kind: 'mine' }

  if (assignee !== null && assignee.kind === 'human')
    return { kind: 'other', holder: assignee.name }

  const member = me?.queues.some(queue => queue.id === ticket.queue.id) ?? false

  if (!member) return { kind: 'outsider', queue: ticket.queue.name }

  return assignee === null ? { kind: 'queued' } : { kind: 'bot', bot: assignee.name }
}

type Composer = { enabled: true; placeholder: string } | { enabled: false; hint: string }

interface Abilities {
  /**
   * The thread header's main button, `null` when there is none to offer.
   */
  primary: 'assume' | 'assumeFromBot' | 'resolve' | null
  composer: Composer
  assign: boolean
  transfer: boolean
  giveBack: boolean
  resolve: boolean
}

const ACT_ON_IT = { assign: true, transfer: true }

/**
 * What the inbox would accept from this agent, mirroring the playground's ticket rules and its
 * `authorize` hook: only the holder closes a ticket in progress.
 */
export function abilitiesOf(posture: Posture): Abilities {
  switch (posture.kind) {
    case 'queued':
      return {
        ...ACT_ON_IT,
        primary: 'assume',
        composer: { enabled: true, placeholder: 'Responder assume a conversa' },
        giveBack: false,
        resolve: true,
      }
    case 'mine':
      return {
        ...ACT_ON_IT,
        primary: 'resolve',
        composer: { enabled: true, placeholder: 'Escreva uma mensagem' },
        giveBack: true,
        resolve: true,
      }
    case 'bot':
      return {
        ...ACT_ON_IT,
        primary: 'assumeFromBot',
        composer: { enabled: true, placeholder: 'Responder assume a conversa do bot' },
        giveBack: true,
        resolve: false,
      }
    case 'other':
      return {
        ...ACT_ON_IT,
        primary: null,
        composer: { enabled: false, hint: `${posture.holder} está atendendo esta conversa.` },
        giveBack: true,
        resolve: false,
      }
    case 'outsider':
      return {
        ...ACT_ON_IT,
        primary: null,
        composer: { enabled: false, hint: `Você não faz parte da fila ${posture.queue}.` },
        giveBack: false,
        resolve: false,
      }
    case 'closed':
      return {
        primary: null,
        composer: { enabled: false, hint: 'Esta conversa foi resolvida.' },
        assign: false,
        transfer: false,
        giveBack: false,
        resolve: false,
      }
    default:
      return posture satisfies never
  }
}
