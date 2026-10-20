import { test } from '@japa/runner'

import {
  SEND_TIMEOUT_MS,
  TASK_POLICY,
  retryOf,
  tasks,
  type InboxQueueJob,
  type InboxTask,
  type QueueDispatch,
} from '../src/tasks.ts'
import type { ChannelEventId, MessageId } from '../src/types.ts'

// SAFETY: fixture ids only need to be numbers.
const ingest: InboxTask = { task: 'ingest', channelEventId: 7 as ChannelEventId, attempt: 0 }

// SAFETY: fixture ids only need to be numbers.
const dispatch: InboxTask = { task: 'dispatch', messageId: 9 as MessageId, attempt: 0 }

class RecordedDispatch implements QueueDispatch {
  queue: string | undefined
  delay: number | undefined

  constructor(
    readonly task: InboxTask,
    readonly log: RecordedDispatch[],
  ) {}

  toQueue(queue: string) {
    this.queue = queue

    return this
  }

  in(delay: number) {
    this.delay = delay

    return this
  }

  async run() {
    this.log.push(this)

    return {}
  }
}

function retries(task: InboxTask) {
  const delays: number[] = []

  for (let next = retryOf(task); next !== null; next = retryOf(next.task)) {
    delays.push(next.delayMs)
  }

  return delays
}

test.group('tasks', () => {
  test('an ingest keeps retrying for longer than a send can take', ({ assert }) => {
    const waited = retries(ingest).reduce((total, delay) => total + delay, 0)

    assert.isAbove(waited, SEND_TIMEOUT_MS)
  })

  test('a {task} runs at most its policy attempts')
    .with([ingest, dispatch])
    .run(({ assert }, task) => {
      assert.lengthOf(retries(task), TASK_POLICY[task.task].attempts - 1)
    })

  test('the inline driver runs an undelayed task before enqueue resolves', async ({ assert }) => {
    const ran: InboxTask[] = []
    const driver = tasks.inline()(async task => void ran.push(task))

    await driver.enqueue(ingest, 0)

    assert.deepEqual(ran, [ingest])
  })

  test('the inline driver drops delayed and new tasks once closed', async ({ assert }) => {
    const ran: InboxTask[] = []
    const driver = tasks.inline()(async task => void ran.push(task))

    await driver.enqueue(ingest, 20)
    driver.close()
    await driver.enqueue(dispatch, 0)
    await new Promise(resolve => setTimeout(resolve, 60))

    assert.deepEqual(ran, [])
  })

  test('the inline driver runs a delayed task after its delay', async ({ assert }) => {
    const ran: InboxTask[] = []
    const driver = tasks.inline()(async task => void ran.push(task))

    await driver.enqueue(ingest, 20)
    await new Promise(resolve => setTimeout(resolve, 60))

    assert.deepEqual(ran, [ingest])
  })

  test('the queue driver dispatches the task to its queue with the delay', async ({ assert }) => {
    const dispatched: RecordedDispatch[] = []
    const job: InboxQueueJob = { dispatch: task => new RecordedDispatch(task, dispatched) }
    const driver = tasks.queue({ job: async () => ({ default: job }), queue: 'inbox' })

    await driver(async () => {}).enqueue(dispatch, 2000)

    assert.deepEqual(
      dispatched.map(({ task, queue, delay }) => ({ task, queue, delay })),
      [{ task: dispatch, queue: 'inbox', delay: 2000 }],
    )
  })
})
