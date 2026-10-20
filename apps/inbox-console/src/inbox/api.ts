import { keepPreviousData, skipToken, useMutation, useQuery } from '@tanstack/react-query'
import { useCallback } from 'react'
import { TuyauError } from '@tuyau/core/client'

import { api, queryClient } from '../app/client.ts'
import { describeFailure, REJECTIONS } from './messages.ts'
import { toast } from './toasts.tsx'
import type { CloseReason, ListFilter, Rejection } from './types.ts'

/**
 * The single seam between the inbox UI and the playground's API. Everything under `src/inbox`
 * reads and writes through these hooks.
 */

const LIST_EVERY_MS = 4000
const THREAD_EVERY_MS = 3000
const DIRECTORY_EVERY_MS = 15_000

function listQuery({ selection, channelId, search }: ListFilter) {
  const query = {
    perPage: 50,
    channelId: channelId ?? undefined,
    search: search.trim() === '' ? undefined : search.trim(),
  }

  return selection.kind === 'view'
    ? { ...query, view: selection.view }
    : { ...query, view: 'open' as const, queueId: selection.queueId }
}

export function useTicketList(filter: ListFilter) {
  return useQuery(
    api.inbox.inboxTickets.index.queryOptions(
      { query: listQuery(filter) },
      { refetchInterval: LIST_EVERY_MS, placeholderData: keepPreviousData },
    ),
  )
}

export function useTicket(ticketId: number | null) {
  return useQuery(
    api.inbox.inboxTickets.show.queryOptions(
      ticketId === null ? skipToken : { params: { id: ticketId } },
      { refetchInterval: THREAD_EVERY_MS },
    ),
  )
}

export function useFlowRuns(ticketId: number) {
  return useQuery(
    api.inbox.flows.inboxFlows.runs.queryOptions(
      { params: { id: ticketId } },
      { refetchInterval: LIST_EVERY_MS },
    ),
  )
}

export function useAgents() {
  return useQuery(
    api.inbox.inboxAttendants.index.queryOptions({}, { refetchInterval: DIRECTORY_EVERY_MS }),
  )
}

export function useQueues() {
  return useQuery(
    api.inbox.inboxQueues.index.queryOptions({}, { refetchInterval: DIRECTORY_EVERY_MS }),
  )
}

export function useChannels() {
  return useQuery(
    api.inbox.inboxChannels.index.queryOptions({}, { refetchInterval: DIRECTORY_EVERY_MS }),
  )
}

function refresh() {
  return queryClient.invalidateQueries(api.inbox.pathFilter())
}

/**
 * Tells the agent why a request on `ticketId` failed. A refusal reads the ticket again first, so
 * the sentence names who holds it now.
 */
async function explain(reason: Rejection | null, error: Error, ticketId: number) {
  if (reason === null) {
    toast.error(describeFailure(error))

    return
  }

  const ticket = await queryClient
    .fetchQuery(api.inbox.inboxTickets.show.queryOptions({ params: { id: ticketId } }))
    .then(
      response => response.data,
      () => null,
    )

  toast.error(
    REJECTIONS[reason]({
      holder: ticket?.assignee?.name ?? null,
      queue: ticket?.queue.name ?? 'desta conversa',
    }),
  )
}

/**
 * Whether a mutation went through. Its `onError` already told the agent why not.
 */
function succeeded<T>(mutation: Promise<T>) {
  return mutation.then(
    () => true,
    () => false,
  )
}

export function useTicketActions(ticketId: number) {
  const params = { id: ticketId }
  const onSettled = refresh

  const assume = useMutation(
    api.inbox.inboxTickets.assume.mutationOptions({
      onSettled,
      onError: error =>
        explain(error.isStatus(409) ? error.response.reason : null, error, ticketId),
    }),
  )

  const assign = useMutation(
    api.inbox.inboxTickets.assign.mutationOptions({
      onSettled,
      onError: error =>
        explain(error.isStatus(409) ? error.response.reason : null, error, ticketId),
    }),
  )

  const transfer = useMutation(
    api.inbox.inboxTickets.transfer.mutationOptions({
      onSettled,
      onError: error =>
        explain(error.isStatus(409) ? error.response.reason : null, error, ticketId),
    }),
  )

  const giveBack = useMutation(
    api.inbox.inboxTickets.requeue.mutationOptions({
      onSettled,
      onError: error =>
        explain(error.isStatus(409) ? error.response.reason : null, error, ticketId),
    }),
  )

  const resolve = useMutation(
    api.inbox.inboxTickets.close.mutationOptions({
      onSettled,
      onError: error =>
        explain(error.isStatus(409) ? error.response.reason : null, error, ticketId),
    }),
  )

  const reply = useMutation(
    api.inbox.inboxMessages.store.mutationOptions({
      onSettled,
      onError: error =>
        explain(error.isStatus(409) ? error.response.reason : null, error, ticketId),
    }),
  )

  const { mutate: read } = useMutation(api.inbox.inboxTickets.read.mutationOptions({ onSettled }))
  const markRead = useCallback(() => read({ params: { id: ticketId } }), [read, ticketId])

  return {
    pending:
      assume.isPending ||
      assign.isPending ||
      transfer.isPending ||
      giveBack.isPending ||
      resolve.isPending,
    replying: reply.isPending ? reply.variables.body.text : null,
    assume: () => succeeded(assume.mutateAsync({ params })),
    assign: (userId: number) => succeeded(assign.mutateAsync({ params, body: { userId } })),
    transfer: (queueId: number) => succeeded(transfer.mutateAsync({ params, body: { queueId } })),
    giveBack: () => succeeded(giveBack.mutateAsync({ params })),
    resolve: (reason: CloseReason, note?: string) =>
      succeeded(resolve.mutateAsync({ params, body: { reason, note } })),
    reply: (text: string) => succeeded(reply.mutateAsync({ params, body: { text } })),
    markRead,
  }
}

export function useDirectoryActions() {
  const onError = (error: Error) => {
    if (!(error instanceof TuyauError && error.status === 422)) toast.error(describeFailure(error))
  }

  const onSettled = refresh

  return {
    createAgent: useMutation(
      api.inbox.inboxAttendants.store.mutationOptions({ onError, onSettled }),
    ),
    deactivate: useMutation(
      api.inbox.inboxAttendants.deactivate.mutationOptions({ onError, onSettled }),
    ),
    addMember: useMutation(api.inbox.inboxQueues.addMember.mutationOptions({ onError, onSettled })),
    removeMember: useMutation(
      api.inbox.inboxQueues.removeMember.mutationOptions({ onError, onSettled }),
    ),
    createQueue: useMutation(api.inbox.inboxQueues.store.mutationOptions({ onError, onSettled })),
    createChannel: useMutation(
      api.inbox.inboxConversations.storeChannel.mutationOptions({ onError, onSettled }),
    ),
    simulate: useMutation(api.inbox.inboxChannels.inbound.mutationOptions({ onError, onSettled })),
  }
}
