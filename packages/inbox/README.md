# @enzopita/adonisjs-inbox

A helpdesk inbox runtime for AdonisJS 7. Contacts write in through channels, their messages land in conversations, and each stretch of attendance is a ticket that moves between queues and attendants. Attendants are humans or bots, and both are rows in one table.

Your app owns every model file and every table. The package owns the runtime: the ticket state machine, webhook ingest with dedupe, the outbound outbox, bot turns and automations. You talk to it through one service, `inbox`.

There is no UI, tenancy, CRM or concrete provider in here. You get extension points instead: `authorize`, `ownership`, `contactKey`, bots, automations and channel adapters.

## Install

```sh
node ace add @enzopita/adonisjs-inbox
node ace migration:run
```

`configure` never overwrites a file you already have. It:

- registers `@enzopita/adonisjs-inbox/inbox_provider` and the `@enzopita/adonisjs-inbox/commands` ace commands in `adonisrc.ts`;
- writes `config/inbox.ts`;
- writes the migrations, today one, `database/migrations/<timestamp>_inbox_0001_create_inbox_tables.ts`, with the `inbox_*` tables inline, so you can add your own columns (a `tenant_id`, say) before you run it;
- writes ten models under `app/models/inbox/`, each `compose(InboxXSchema, withInboxX())` with its relations declared.

`migration:run` creates the tables and regenerates `database/schema.ts`, which the models extend. Then schedule `node ace inbox:tick` every minute, from cron or a scheduler (see [Tick and recovery](#tick-and-recovery)).

## Upgrading

```sh
node ace inbox:migrations
node ace migration:run
```

A release that changes the schema ships a new migration instead of editing the one you have. `inbox:migrations` writes each migration this version needs and `database/migrations` lacks, in order and timestamped after your newest one, and prints what it wrote. A second run writes nothing. It knows a migration by the id in its file name, `<timestamp>_inbox_<id>_<name>.ts`, so keep that part of the name if you rename or move one. The contents are yours to edit: it never opens or rewrites a file you have.

`node ace inbox:migrations --check` writes nothing and exits with 1 when a migration is missing, for CI.

Until you migrate, the first use of a model that lacks one of the package's columns throws an `InboxError` with the code `E_INBOX_SCHEMA_OUTDATED`, naming the column, the migration and these two commands. The check reads the model's columns, which `migration:run` regenerates in `database/schema.ts`, so it runs no query.

## Config

```ts
// config/inbox.ts
import {
  adapters,
  automations,
  defineConfig,
  tasks,
  type InferBots,
} from '@enzopita/adonisjs-inbox'

const inboxConfig = defineConfig({
  models: {
    attendant: () => import('#models/inbox/attendant'),
    // ...one entry per model role
    ticketEvent: () => import('#models/inbox/ticket_event'),
  },

  bots: {
    triage: () => import('#bots/triage_bot'),
  },

  automations: [
    automations.assignOnOpen({ bot: 'triage', when: ({ now }) => now.hour >= 18 }),
    automations.closeInactive({ after: { hours: 48 } }),
  ],

  // Keyed by the provider column of your channels
  channels: { fake: adapters.fake() },

  tasks: tasks.inline(),

  // Return false and the call comes back { outcome: 'rejected', reason: 'forbidden' }
  authorize: ({ actor, operation, ticket }) =>
    operation.gesture !== 'close' || actor.kind === 'human',

  // Merged into every row created from this channel
  ownership: channel => ({ tenantId: channel.tenantId }),
})

export default inboxConfig

declare module '@enzopita/adonisjs-inbox/types' {
  interface InboxBots extends InferBots<typeof inboxConfig> {}
}
```

- `models` has one slot per role in `MODEL_ROLES`. Leaving one out, or pointing it at a model without its role's mixin, fails to compile. A JavaScript config fails the boot instead.
- `bots` maps each bot key to a lazily imported class implementing `Bot`. The keys type the automations, so `automations.assignOnOpen({ bot: 'nope' })` fails to compile, and with the `InboxBots` augmentation so does `inbox.attendants.bot('nope')`.
- `automations` run in order on their trigger. See [Automations](#automations).
- `channels` maps each provider to its adapter.
- `tasks` runs the work after a commit: ingesting a webhook, dispatching a message and running a bot turn. `tasks.inline()` runs it in the process, and a delayed task (a retry, a bot's debounce) waits on a timer that a restart loses. `tasks.queue({ job })` hands it to an `@adonisjs/queue` job whose `execute` calls `inbox.run(this.payload)`.
- `authorize` runs against the freshly read ticket on every attempt of `inbox.tickets.apply`, and of `inbox.messages.send` with the operation `{ gesture: 'send' }`. Bots, automations and the releases the package does itself skip it, since they are your own code or the package's housekeeping.
- `ownership` fills your own columns on every row the inbox creates from a channel: its stored webhooks, contacts, conversations, tickets, ticket events and messages. They go through `Model.create`, so your model hooks still run.

## Models

The mixins come from `@enzopita/adonisjs-inbox/mixins`. They add no columns and no relations. They narrow the generated columns (`status` to a union, ids to branded types, JSON text columns to parsed values) and add read helpers:

- `ticket.snapshot` and `ticket.state`, the ticket as the `TicketState` sum type;
- `attendant.asAttendant`, `{ kind: 'human', userId } | { kind: 'bot', botKey }` with `active`.

CHECK constraints in the migration admit exactly the rows those helpers can parse. A ticket that is in progress has an assignee, a closed one has a close reason, and an attendant has a user id or a bot key, never both.

## The inbox service

```ts
import inbox from '@enzopita/adonisjs-inbox/services/main'

const me = await inbox.attendants.forUser(auth.getUserOrFail().id)
const result = await inbox.tickets.apply(ticket.id, { gesture: 'assume' }, me)

if (result.outcome === 'rejected') return response.conflict({ reason: result.reason })
```

| Call                                           | Does                                                                                                            |
| ---------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| `tickets.apply(id, gesture, actor)`            | `assume`, `assign`, `transfer`, `return` or `close`. Returns `changed`, `unchanged` or `rejected` with a reason |
| `tickets.markRead(id, attendant)`              | Zeroes the unread count when the attendant holds the ticket                                                     |
| `tickets.open(conversationId, queueId, actor)` | Opens a queued ticket, or returns the one already open in that conversation                                     |
| `tickets.wake(id, bot, token, { in? })`        | Runs a `wake` turn of that bot after `in`, if it still holds the ticket then. See [Bots](#bots)                 |
| `attendants.forUser(userId)` / `.bot(key)`     | The attendant row of a user or of a bot from `config.bots`, created on first use                                |
| `attendants.deactivate(attendant)`             | Marks it inactive and returns every ticket it holds to its queue                                                |
| `queues.addMember(queueId, attendant)`         | Adds the membership a human needs to hold tickets in that queue                                                 |
| `queues.removeMember(queueId, attendant)`      | Removes it and returns the attendant's tickets in that queue                                                    |
| `messages.send(id, content, author, options)`  | Replies on the ticket. Returns `queued` with the message id, or `rejected` with a reason                        |
| `ingest(token, request)`                       | The webhook entry. Returns `accepted`, `unknown_channel` or `invalid_signature`                                 |
| `tick(now?)`                                   | Runs the tick automations, then `recover()`. `node ace inbox:tick` calls it                                     |
| `recover()`                                    | Queues again webhooks and sends whose task was lost, and gives up on the ones older than a day                  |
| `ownership(conversationId)`                    | What `config.ownership` fills on the rows of the conversation's channel, for a package's own rows               |

There are no locks. `apply` reads the ticket, plans the gesture with the pure `plan` function and writes it with a compare-and-swap on `version`. When another write landed in between, it reads and plans again, up to three times, and then gives up with `conflict`. A unique index on the open conversation keeps one open ticket per conversation. This works the same on sqlite, pg and mysql.

Every change appends rows to `inbox_ticket_events`, in the same transaction. After the commit the app emitter gets `inbox:ticket_opened` and `inbox:ticket_changed`.

## Channels and messages

A channel adapter implements `ChannelAdapter`: `verify` and `parse` a webhook, and `send` a message. Its `capabilities` list what it can do beyond that, such as `send_text`. Message content is the `MessageContent` union, `{ kind: 'text', text }` for now, and a send of a kind the adapter doesn't declare comes back `rejected` with `unsupported_content`. The optional `connect`, `disconnect` and `checkHealth` are reserved for providers with a session to pair, and the inbox doesn't call them yet.

`ingest` verifies the request, stores the body and queues its processing. Processing creates the contact, the conversation and a queued ticket on first contact, stores the message once however often the webhook repeats, and counts it unread. A status only moves forward, so a `read` that arrives before its `delivered` stays `read`.

`messages.send` writes the message pending in the same compare-and-swap as the ticket, so a human replying to a queued ticket assumes it, and a reply to a ticket another human holds is rejected. After the commit a dispatch claims the message with a lease and sends it once. A retry with the same `clientRef` returns the message the first call stored.

Ingest writes an inbound message as the system actor `ingest`. A ticket it opens runs the `ticket_opened` automations in the opening transaction, and the message runs the `message_received` ones in its own write.

`@enzopita/adonisjs-inbox/testing` exports `FakeChannelAdapter`, `fakeWebhookBody` and `channelAdapterContract`, the Japa suite every adapter should pass. For specs that drive a real app, such as a package's playground, it also exports `bootApp(appRoot, inboxConfig)`, which boots the app in the test process on its SQLite file in `tmp/db.sqlite3`, `migrateApp(appRoot)`, `modelsIn(appRoot)` for the models `configure` writes, `channelIn(app)`, which inserts a queue and a fake channel and writes in as a contact through the webhook entry, and `eventually(condition)`, which waits on a delayed task.

## Bots

A bot is an attendant whose turns the package runs. It implements `Bot`, and the container makes it once, so `@inject()` works:

```ts
// app/bots/triage_bot.ts
import { inject } from '@adonisjs/core'
import { Logger } from '@adonisjs/core/logger'
import type { Bot, BotReply, BotTurn } from '@enzopita/adonisjs-inbox'

// A type alias, not an interface, so it is assignable to JsonValue
type TriageState = { greeted: boolean }

@inject()
export default class TriageBot implements Bot<TriageState> {
  debounce = { seconds: 1 }

  constructor(protected logger: Logger) {}

  initialState(): TriageState {
    return { greeted: false }
  }

  async turn({ state, unanswered }: BotTurn<TriageState>): Promise<BotReply<TriageState>> {
    if (!state.greeted) {
      return {
        kind: 'reply',
        messages: [{ kind: 'text', text: 'Hi! What do you need help with?' }],
        state: { greeted: true },
      }
    }

    return {
      kind: 'reply',
      messages: [{ kind: 'text', text: 'Thanks! Someone from the team will take it from here.' }],
      state,
      handoff: {
        gesture: 'return',
        note: unanswered.map(({ content }) => content.text).join('\n'),
      },
    }
  }
}
```

You never call a bot. A ticket reaches it through `{ gesture: 'assign', to: bot.id }`, where `bot = await inbox.attendants.bot('triage')`, or through an automation. From then on the package runs a turn:

- after each inbound message on a ticket the bot holds, once `debounce` passed without a newer message, with `trigger: 'message'`;
- when the bot gets the ticket from a human or an automation, with `trigger: 'assigned'` and the `version` that handover gave the ticket. A turn run again on a fresh read sees the ticket past it, so a bot keeping its own records can tell the ones it wrote since the handover from older ones. A bot handing the ticket to another bot leaves that one to the next message, so two bots never pass a ticket back and forth;
- when you call `inbox.tickets.wake(ticketId, 'triage', token, { in: { minutes: 10 } })`, with `trigger: 'wake'` and that `token`, after the delay and without the debounce. The turn does nothing unless the bot still holds the ticket then. Whether the wake is still due is the bot's call, made from the token, such as a reminder it has since cancelled. Through `tasks.queue()` the delay survives a restart, and through `tasks.inline()` it doesn't.

Every turn also carries the ticket's `channel` (`{ id, provider }`) and `contactId`.

`unanswered` holds the inbound messages since the last reply by an attendant, human or bot. A turn answers with one of:

| Reply                                          | Does                                                                                     |
| ---------------------------------------------- | ---------------------------------------------------------------------------------------- |
| `{ kind: 'reply', messages, state, handoff? }` | Sends the messages, stores the state, then `return`s, `transfer`s or `close`s the ticket |
| `{ kind: 'silent', state }`                    | Stores the state only. The messages stay unanswered for the next turn                    |
| `{ kind: 'wait', retryIn }`                    | Runs the turn again after `retryIn`, such as while a file is still processing            |

`turn` runs outside any transaction, so a slow model call holds no lock. The replies, the state and the handoff then commit in one write, guarded by the ticket version the turn read:

- When a human took the ticket meanwhile, the turn is dropped and nothing is sent.
- When a message arrived meanwhile, the turn runs again with the longer batch, three times at most, and then commits its last answer over the latest version.
- A committed turn never runs again, and a turn delivered twice finds nothing to do, so a reply goes out once.
- A turn that throws is retried with backoff, four attempts in all, and a `wait` uses one of them.

A `reply` or `silent` can also carry `within`, the bot's own writes in the turn's transaction, made after its replies are stored. They land with the turn or roll back with it, and `later` runs work after the commit:

```ts
return {
  kind: 'reply',
  messages: [{ kind: 'text', text: 'Booked for Tuesday.' }],
  state,
  within: async (trx, ticket, later) => {
    const booking = await Booking.find(bookingId, { client: trx })

    // Moved since the turn read it
    if (booking === null || booking.revision !== revision) return 'stale'

    booking.merge({ status: 'confirmed', revision: revision + 1 })
    await booking.save()
    later(() => emitter.emit('booking:confirmed', { ticketId: ticket.id }))

    return 'ok'
  },
}
```

`within` returns `stale` when a row of the bot's moved since the turn read it. Nothing commits, and the turn runs again on a fresh read, three times at most, like a turn whose batch grew. A turn still stale after that is dropped and logged, with nothing sent. A `within` that throws rolls back the whole turn, which is then retried like any turn that throws.

The bot's state is kept per bot attendant on the ticket, so a bot that gets the ticket back resumes where it left off. A human takes it back at any time with `{ gesture: 'assume' }`, or by replying.

## Automations

An automation returns effects as data, and the package applies them through the ticket state machine, as the system actor named after the automation. An effect is `{ effect: 'apply', gesture }`, `{ effect: 'assign_bot', bot }` or `{ effect: 'send', content }`. A send is stored pending with no author and dispatched like any message. It doesn't count as a reply, so a bot still answers the message it followed.

| Built-in                                | Trigger            | Does                                                              |
| --------------------------------------- | ------------------ | ----------------------------------------------------------------- |
| `assignOnOpen({ bot, when? })`          | `ticket_opened`    | Opens the ticket already assigned to the bot                      |
| `assignQueuedOnMessage({ bot, when })`  | `message_received` | Hands a queued ticket to the bot when a message arrives           |
| `autoReply({ text \| content, when? })` | `ticket_opened`    | Sends a message on every ticket that opens                        |
| `closeInactive({ after, reason? })`     | `tick`             | Closes open tickets with no activity for `after`, as `inactivity` |

Your own automation has the same shape:

```ts
import { defineAutomation } from '@enzopita/adonisjs-inbox'

export const closeAbandonedQueued = defineAutomation({
  name: 'close_abandoned_queued',
  on: 'tick',
  candidates: ({ now }) => ({ status: 'queued', lastActivityBefore: now.minus({ days: 7 }) }),
  decide: ({ ticket, now }) =>
    ticket.lastActivityAt < now.minus({ days: 7 })
      ? [{ effect: 'apply', gesture: { gesture: 'close', reason: 'inactivity' } }]
      : [],
})
```

- `ticket_opened` and `message_received` automations run on the ticket their trigger leaves, and their effects land in the trigger's own write. A ticket `assignOnOpen` assigns is never seen queued. `message_received` runs on inbound messages only.
- `tick` automations run from `inbox.tick()`. `candidates` returns plain column comparisons (`status`, `lastActivityBefore`, `queueId`, `assigneeKind`), with `status` defaulting to open tickets. `decide` runs again on each fresh read of every candidate, and its effects land in one compare-and-swap, so running a tick twice changes nothing twice. A tick automation that only sends sends on every tick, so pair a send with a change.
- Each automation sees the ticket the ones before it left. One whose effects the state machine rejects is skipped and logged, and the others still apply.
- Effects never trigger automations, so automations can't loop through each other.

## Tick and recovery

```sh
node ace inbox:tick
```

Run it every minute. It calls `inbox.tick()`, which runs the tick automations and then `inbox.recover()`. `recover` queues again the stored webhooks no ingest processed and the pending messages no dispatch owns, once they are older than a dispatch lease (`DISPATCH_LEASE_MS`), newest first and `RECOVER_BATCH` of each per run. Work older than `GIVE_UP_AFTER_MS`, a day, is marked failed instead: a webhook gets `failed_at`, and a message gets status `failed` with the failure code `expired`. So work that keeps failing stops being retried, and you can find it by those markers.

## Pure parts

`plan(ticket, gesture, actor, context)` is the ticket state machine as a pure function, exported with `holder`, `planOpening` and `KIND_RULES`. The domain types come from `@enzopita/adonisjs-inbox/types`. `InboxError`, with a stable `code`, is thrown only for broken config, a schema behind the package's migrations, rows the CHECK constraints forbid and programmer errors.
