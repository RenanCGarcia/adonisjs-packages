# @enzopita/adonisjs-inbox

A helpdesk inbox runtime for AdonisJS 7. Contacts write in through channels, their messages land in conversations, and each stretch of attendance is a ticket that moves between queues and attendants. Attendants are humans or bots, and both are rows in one table.

Your app owns every model file and every table. The package owns the ticket rules and talks to you through one service, `inbox`.

> v1 is in progress. Tickets, attendants and queues work. Channels, webhook ingest, sending messages, bots and automations are not there yet.

## Install

```sh
node ace add @enzopita/adonisjs-inbox
node ace migration:run
```

`configure` never overwrites a file you already have. It:

- registers `@enzopita/adonisjs-inbox/inbox_provider` in `adonisrc.ts`;
- writes `config/inbox.ts`;
- writes one migration, `database/migrations/<timestamp>_create_inbox_tables.ts`, with the `inbox_*` tables inline, so you can add your own columns (a `tenant_id`, say) before you run it;
- writes ten models under `app/models/inbox/`, each `compose(InboxXSchema, withInboxX())` with its relations declared.

`migration:run` creates the tables and regenerates `database/schema.ts`, which the models extend.

## Config

```ts
// config/inbox.ts
import { defineConfig, type InferBots } from '@enzopita/adonisjs-inbox'

const inboxConfig = defineConfig({
  models: {
    attendant: () => import('#models/inbox/attendant'),
    // ...one entry per model role
    ticketEvent: () => import('#models/inbox/ticket_event'),
  },

  bots: ['triage'],

  // Return false and the call comes back { outcome: 'rejected', reason: 'forbidden' }
  authorize: ({ actor, operation, ticket }) =>
    operation.gesture !== 'close' || actor.kind === 'human',

  // Merged into every ticket opened in a conversation of this channel
  ownership: channel => ({ tenantId: channel.tenantId }),
})

export default inboxConfig

declare module '@enzopita/adonisjs-inbox/types' {
  interface InboxBots extends InferBots<typeof inboxConfig> {}
}
```

- `models` has one slot per role in `MODEL_ROLES`. Leaving one out, or pointing it at a model without its role's mixin, fails to compile. A JavaScript config fails the boot instead.
- `bots` lists the bot keys. With the `InboxBots` augmentation, `inbox.attendants.bot('nope')` fails to compile.
- `authorize` runs against the freshly read ticket on every attempt of `inbox.tickets.apply`. The releases the package does itself skip it.
- `ownership` fills your own columns through `Model.create`, so your model hooks still run.

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
| `attendants.forUser(userId)` / `.bot(key)`     | The attendant row of a user or of a bot from `config.bots`, created on first use                                |
| `attendants.deactivate(attendant)`             | Marks it inactive and returns every ticket it holds to its queue                                                |
| `queues.addMember(queueId, attendant)`         | Adds the membership a human needs to hold tickets in that queue                                                 |
| `queues.removeMember(queueId, attendant)`      | Removes it and returns the attendant's tickets in that queue                                                    |

There are no locks. `apply` reads the ticket, plans the gesture with the pure `plan` function and writes it with a compare-and-swap on `version`. When another write landed in between, it reads and plans again, up to three times, and then gives up with `conflict`. A unique index on the open conversation keeps one open ticket per conversation. This works the same on sqlite, pg and mysql.

Every change appends rows to `inbox_ticket_events`, in the same transaction. After the commit the app emitter gets `inbox:ticket_opened` and `inbox:ticket_changed`.

## Pure parts

`plan(ticket, gesture, actor, context)` is the ticket state machine as a pure function, exported with `holder`, `planOpening` and `KIND_RULES`. The domain types come from `@enzopita/adonisjs-inbox/types`. `InboxError`, with a stable `code`, is thrown only for broken config, rows the CHECK constraints forbid and programmer errors.
