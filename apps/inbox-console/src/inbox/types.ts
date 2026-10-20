import type { Route } from '@tuyau/core/types'
import type { routes } from 'playground/registry'

type TicketList = Route.Response<'inbox.inbox_tickets.index'>

export type TicketRow = TicketList['data'][number]

export type TicketDetail = Route.Response<'inbox.inbox_tickets.show'>['data']

export type Message = TicketDetail['messages'][number]

export type MessageStatus = NonNullable<Message['status']>

export type TicketEvent = TicketDetail['events'][number]

export type Fact = TicketEvent['data']

export type Agent = Route.Response<'inbox.inbox_attendants.index'>['data'][number]

export type Queue = Route.Response<'inbox.inbox_queues.index'>['data'][number]

export type Channel = Route.Response<'inbox.inbox_channels.index'>['data'][number]

export type FlowRun = Route.Response<'inbox.flows.inbox_flows.runs'>[number]

export type View = keyof TicketList['views']

export type CloseReason = Route.Body<'inbox.inbox_tickets.close'>['reason']

export type AttendantRef = NonNullable<TicketRow['assignee']>

type Reason<Name extends keyof typeof routes> =
  (typeof routes)[Name]['types']['errorResponse'] extends infer Failure
    ? Failure extends { status: 409; response: { reason: infer Why } }
      ? Why
      : never
    : never

/**
 * Every reason the inbox gives for refusing a ticket gesture or a reply, as the controllers
 * answer it with a 409.
 */
export type Rejection = Reason<
  | 'inbox.inbox_tickets.assume'
  | 'inbox.inbox_tickets.assign'
  | 'inbox.inbox_tickets.transfer'
  | 'inbox.inbox_tickets.requeue'
  | 'inbox.inbox_tickets.close'
  | 'inbox.inbox_messages.store'
>

/**
 * What the left nav selects: one of the inbox views, or the open tickets of one queue.
 */
export type Selection = { kind: 'view'; view: View } | { kind: 'queue'; queueId: Queue['id'] }

export interface ListFilter {
  selection: Selection
  channelId: Channel['id'] | null
  search: string
}
