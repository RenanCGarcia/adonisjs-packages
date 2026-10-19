import type { ChannelEventId, MessageId } from './types.ts'

/**
 * The inbox's work after a commit, as plain JSON so a queue can carry it. Every task is
 * idempotent, so running one twice converges.
 */
export type InboxTask =
  | { task: 'ingest'; channelEventId: ChannelEventId; attempt: number }
  | { task: 'dispatch'; messageId: MessageId; attempt: number }

/**
 * How long a dispatch owns a pending message. A worker that dies mid-send loses it after this.
 */
export const DISPATCH_LEASE_MS = 120_000

/**
 * Derived from the lease, so a send always ends while its dispatch still owns the message.
 */
export const SEND_TIMEOUT_MS = DISPATCH_LEASE_MS / 4

interface RetryPolicy {
  attempts: number
  firstDelayMs: number
  maxDelayMs: number
}

/**
 * The delays double up to the cap. An ingest backs off for longer than a send can take, so an
 * echo or a status that arrives before our own send's bookkeeping finds it settled on a retry.
 */
export const TASK_POLICY = {
  ingest: { attempts: 7, firstDelayMs: 1000, maxDelayMs: 30_000 },
  dispatch: { attempts: 6, firstDelayMs: 2000, maxDelayMs: 60_000 },
} as const satisfies Record<InboxTask['task'], RetryPolicy>

/**
 * The retry of a failed task, or null once it ran out of attempts.
 */
export function retryOf(task: InboxTask) {
  const policy: RetryPolicy = TASK_POLICY[task.task]

  if (task.attempt + 1 >= policy.attempts) return null

  return {
    task: { ...task, attempt: task.attempt + 1 },
    delayMs: Math.min(policy.maxDelayMs, policy.firstDelayMs * 2 ** task.attempt),
  }
}

export type RunTask = (task: InboxTask) => Promise<void>

/**
 * Called after the commit that made the task. The inbox retries a failed task itself, through
 * `enqueue`, so a driver never retries.
 */
export interface TaskDriver {
  enqueue(task: InboxTask, delayMs: number): Promise<void>
}

export type TaskDriverFactory = (run: RunTask) => TaskDriver

/**
 * The part of an `@adonisjs/queue` job class the queue driver calls. Typed by its structure, so
 * the inbox doesn't depend on the queue package.
 */
export interface QueueDispatch {
  toQueue(queue: string): QueueDispatch
  in(delay: number): QueueDispatch
  run(): Promise<object>
}

export interface InboxQueueJob {
  dispatch(task: InboxTask): QueueDispatch
}

export interface QueueDriverOptions {
  job: () => Promise<{ default: InboxQueueJob }>
  queue?: string
}

export const tasks = {
  /**
   * Runs a task in this process, awaited when it has no delay. A delayed retry waits on a
   * timer, which a restart loses.
   */
  inline(): TaskDriverFactory {
    return run => ({
      async enqueue(task, delayMs) {
        if (delayMs === 0) return run(task)

        setTimeout(() => void run(task), delayMs).unref()
      },
    })
  },

  /**
   * Dispatches each task to your job, whose `execute` calls `inbox.run(this.payload)`.
   */
  queue(options: QueueDriverOptions): TaskDriverFactory {
    return () => ({
      async enqueue(task, delayMs) {
        const { default: job } = await options.job()
        const dispatch = job.dispatch(task).in(delayMs)

        await (options.queue === undefined ? dispatch : dispatch.toQueue(options.queue)).run()
      },
    })
  },
}
