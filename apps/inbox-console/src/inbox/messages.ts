import { TuyauError } from '@tuyau/core/client'

import type { CloseReason, Fact, MessageStatus, Rejection, View } from './types.ts'

/**
 * What the agent needs to read a refusal: who holds the ticket and which queue it is in, as
 * the ticket stands after the refusal.
 */
export interface RefusalContext {
  holder: string | null
  queue: string
}

export const REJECTIONS: Record<Rejection, (context: RefusalContext) => string> = {
  held_by_other: ({ holder }) =>
    holder === null
      ? 'Esta conversa já está com outra pessoa.'
      : `Esta conversa já está com ${holder}.`,
  not_member: ({ queue }) => `Você não faz parte da fila ${queue}.`,
  conflict: () => 'Alguém alterou esta conversa agora. Atualizamos para você.',
  closed: () => 'Esta conversa já foi resolvida.',
  already_closed: () => 'Esta conversa já foi resolvida.',
  not_assignee: ({ holder }) =>
    holder === null
      ? 'Só quem está atendendo pode responder esta conversa.'
      : `Só ${holder} pode responder esta conversa agora.`,
  attendant_inactive: () => 'Este agente está desativado e não pode atender.',
  actor_cannot_hold: () => 'Esta conta não pode atender conversas.',
  forbidden: ({ holder }) =>
    holder === null
      ? 'Você não tem permissão para fazer isso nesta conversa.'
      : `Só ${holder} pode resolver esta conversa.`,
  unsupported_content: () => 'Este canal não aceita esse tipo de mensagem.',
}

export function describeFailure(error: Error) {
  if (!(error instanceof TuyauError)) return 'Algo deu errado. Tente de novo.'

  if (error.kind === 'network') return 'Sem conexão com o servidor. Verifique se ele está no ar.'

  if (error.status === 401) return 'Sua sessão expirou. Entre de novo.'

  if (error.status === 404)
    return 'Não encontramos o que você procurava. Talvez tenha sido removido.'

  if (error.status === 422) return 'Confira os campos destacados.'

  return 'Algo deu errado no servidor. Tente de novo em instantes.'
}

export const VIEW_LABELS: Record<View, string> = {
  mine: 'Minhas conversas',
  unassigned: 'Não atribuídas',
  bot: 'Com bot',
  open: 'Todas abertas',
  closed: 'Resolvidas',
}

export const VIEW_EMPTY: Record<View, string> = {
  mine: 'Você não tem conversas em atendimento. Assuma uma em "Não atribuídas".',
  unassigned: 'Ninguém esperando. Todas as conversas têm alguém cuidando.',
  bot: 'Nenhuma conversa com o bot agora.',
  open: 'Nenhuma conversa aberta.',
  closed: 'Nenhuma conversa resolvida ainda.',
}

export const STATUS_LABELS: Record<MessageStatus, string> = {
  pending: 'Pendente',
  sent: 'Enviada',
  delivered: 'Entregue',
  read: 'Lida',
  played: 'Ouvida',
  failed: 'Falhou',
}

/**
 * `agent` marks the reasons an agent picks when resolving. The others are the inbox's own.
 */
export const CLOSE_REASONS: Record<CloseReason, { label: string; agent: boolean }> = {
  manual: { label: 'Atendimento concluído', agent: true },
  inactivity: { label: 'Cliente sem resposta', agent: true },
  bot_completed: { label: 'Concluída pelo bot', agent: false },
  channel_removed: { label: 'Canal removido', agent: false },
}

/**
 * One centered line in the thread for a ticket event. `name` resolves an attendant reference to
 * a person or bot, and `queue` a queue id to its name.
 */
export function describeFact(
  fact: Fact,
  actor: string,
  name: (ref: { kind: string; id: number }) => string,
  queue: (id: number) => string,
) {
  switch (fact.fact) {
    case 'opened':
      return fact.origin === 'inbound'
        ? `Conversa aberta na fila ${queue(fact.queueId)}`
        : `${actor} iniciou a conversa`
    case 'queue_changed':
      return `${actor} transferiu de ${queue(fact.from)} para ${queue(fact.to)}`
    case 'assignment_changed':
      switch (fact.via) {
        case 'assume':
          return `${actor} assumiu a conversa`
        case 'reply':
          return `${actor} assumiu ao responder`
        case 'return':
          return `${actor} devolveu à fila`
        case 'assign':
        case 'transfer':
          if (fact.to === null) return `${actor} deixou a conversa sem responsável`

          return fact.to.kind === 'bot'
            ? `${actor} passou a conversa para o bot`
            : `${actor} atribuiu a ${name(fact.to)}`
        case 'close':
          return `${actor} resolveu a conversa`
        default:
          return fact.via satisfies never
      }

    case 'closed':
      return `${actor} resolveu · ${CLOSE_REASONS[fact.reason].label}`
    default:
      return fact satisfies never
  }
}
