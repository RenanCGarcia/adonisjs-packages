# @enzopita/adonisjs-inbox-flows

Deterministic chat flows for [`@enzopita/adonisjs-inbox`](../inbox). End users connect nodes in an editor. Developers write the node types in code, one `defineNode` object per type. Flows run as one bot of the inbox, so a flow's replies, its handoff and its own bookkeeping commit in the same transaction as the ticket.

The package is headless. It ships the graph format, the node registry and catalog, the checks the editor and the server share, the tables and models, the flows bot, the `inboxFlows` service and the `flows:tick` command. The editor UI is not in here.

## Install

```sh
node ace add @enzopita/adonisjs-inbox-flows
node ace migration:run
```

`configure` never overwrites a file you already have. It:

- registers `@enzopita/adonisjs-inbox-flows/inbox_flows_provider` and the `@enzopita/adonisjs-inbox-flows/commands` ace commands in `adonisrc.ts`;
- writes `config/inbox_flows.ts`;
- writes one migration with the `inbox_flows`, `inbox_flow_versions`, `inbox_flow_bindings`, `inbox_flow_runs` and `inbox_flow_effects` tables;
- writes five models under `app/models/inbox/`, each `compose(InboxFlowXSchema, withInboxFlowX())`.

Then register the flows bot in `config/inbox.ts`, and hand it the tickets it should look at. One bot key runs every flow:

```ts
// config/inbox.ts
bots: {
  flows: () => import('@enzopita/adonisjs-inbox-flows/bot'),
},
automations: [
  automations.assignOnOpen({ bot: 'flows', when: ({ channel }) => channel.provider === 'whatsapp' }),
],
```

Schedule `node ace flows:tick` every minute, next to `inbox:tick` (see [The tick](#the-tick)).

## Config

```ts
// config/inbox_flows.ts
import { builtins, defineConfig, defineNodes } from '@enzopita/adonisjs-inbox-flows'

export default defineConfig({
  bot: 'flows',
  models: {
    flow: () => import('#models/inbox/flow'),
    flowVersion: () => import('#models/inbox/flow_version'),
    flowBinding: () => import('#models/inbox/flow_binding'),
    flowRun: () => import('#models/inbox/flow_run'),
    flowEffect: () => import('#models/inbox/flow_effect'),
  },
  nodes: defineNodes([...builtins, askEmail, addTag]),
})
```

- `bot` is the `config.bots` key the flows bot is registered under.
- `models` takes one model per role, each built from its mixin in `@enzopita/adonisjs-inbox-flows/mixins`. A model without the role's mixin fails when it is first used.
- `nodes` is the registry. It is the only list of node types, effects and effect handlers.
- `maxSteps` caps the nodes one turn runs. It defaults to 50.
- `debounce` is how long the bot waits for more messages before it answers. It defaults to one second.
- `closeReasons` lists the close reasons a `close` node may name. The inbox's close reasons are a type you augment, so the package can't read them at runtime. It defaults to the inbox's own four.
- `startDeadline` is how long a manual start may wait for its assign. It defaults to two minutes.
- `validatePublish({ flowId, graph })` returns problems of your own, such as a queue that belongs to another tenant. They block a publish like the package's.

## Graphs

A graph uses xyflow's field names, so `<ReactFlow nodes={graph.nodes} edges={graph.edges}>` loads it without remapping.

```ts
const graph: FlowGraph = {
  schemaVersion: 1,
  variables: [{ name: 'name', type: 'text' }],
  nodes: [
    { id: 'n1', type: 'start', typeVersion: 1, position: { x: 0, y: 0 }, data: {} },
    {
      id: 'n2',
      type: 'question',
      typeVersion: 1,
      position: { x: 200, y: 0 },
      data: { text: 'Your name?', variable: 'name', capture: 'text', retries: 1 },
    },
    {
      id: 'n3',
      type: 'message',
      typeVersion: 1,
      position: { x: 400, y: 0 },
      data: { text: 'Thanks, {{name}}' },
    },
    { id: 'n4', type: 'end', typeVersion: 1, position: { x: 600, y: 0 }, data: {} },
  ],
  edges: [
    { id: 'e1', source: 'n1', sourceHandle: 'default', target: 'n2' },
    { id: 'e2', source: 'n2', sourceHandle: 'answered', target: 'n3' },
    { id: 'e3', source: 'n3', sourceHandle: 'default', target: 'n4' },
  ],
}
```

- `sourceHandle` is the port. Every node has one input, so there is no `targetHandle`.
- `data` is the node's config.
- `typeVersion` is the version of the node type the config was written against.
- Variables are declared on the graph, each with a type: `text`, `number` or `boolean`. A run stores values tagged with their type, so `gt` compares numbers as numbers.
- `{{name}}` in a template field renders the variable. An unset variable renders as `''`.

`graphHash(graph)` is the publish identity. It leaves out positions and edge ids, and it sorts nodes, edges, variables and config keys. Moving a node or reconnecting the same port never produces a new hash.

## Node types

```ts
import vine from '@vinejs/vine'
import { builtins, defineEffect, defineNode, defineNodes } from '@enzopita/adonisjs-inbox-flows'

const askEmail = defineNode({
  type: 'ask_email',
  typeVersion: 1,
  config: vine.object({ prompt: vine.string(), variable: vine.string(), retry: vine.string() }),
  defaults: { prompt: 'Your email?', variable: 'email', retry: 'That is not an email.' },
  fields: {
    prompt: { label: 'Question', binds: 'template' },
    variable: { label: 'Save as', binds: { writes: ['text'] } },
    retry: { label: 'When invalid', binds: 'template' },
  },
  ports: [{ id: 'valid' }, { id: 'invalid' }],
  ui: { label: 'Ask for email', category: 'Capture', icon: 'at-sign', summary: '{{prompt}}' },

  enter: ({ config }) => ({ say: [config.prompt], wait: { for: 'message' } }),

  resume: ({ config }, input) => {
    if (input.kind === 'elapsed') return { go: 'invalid' }

    const email = input.text.trim().toLowerCase()

    return email.includes('@')
      ? { go: 'valid', set: { variable: { type: 'text', value: email } } }
      : { go: 'invalid', say: [config.retry] }
  },
})

const addTag = defineNode({
  type: 'add_tag',
  typeVersion: 1,
  config: vine.object({ tag: vine.string().minLength(1) }),
  defaults: { tag: '' },
  ports: [{ id: 'default' }],
  effect: defineEffect({
    payload: vine.object({ tag: vine.string() }),
    delivery: 'in_transaction',
    handler: () => import('#flows/add_tag_effect'),
  }),
  ui: { label: 'Add tag', category: 'Actions' },
  execute: ({ config }) => ({ go: 'default', effect: { tag: config.tag } }),
})

export const nodes = defineNodes([...builtins, askEmail, addTag])
```

A node has `execute`, which runs and moves on, or `enter` with `resume`, which waits for a message or a time and then moves on. Both are pure: they get the config, `now` and the variables their fields bind, and they return data.

- `go` names a port. A port the node doesn't declare fails to compile.
- `set` is keyed by the config field that names the variable, so a node only writes what a field binds with `writes`, with a value of a type the binding allows. Anything else fails to compile.
- `read(field)` takes only fields that bind with `reads`.
- `effect` must match the payload schema of the node's `effect`. The registry derives `nodes.effects` from the nodes, so effects and their handlers are never listed twice.
- `fields` holds the editor hints per config field. `binds` is the one place that says what a field means. A `template` field renders before the node runs, and its placeholders count as reads. A `writes` or `reads` field names a variable. The checks, the interpreter and the editor all read it.
- `ports` is static, or `{ from: 'options' }` for one port per item of an array field of `{ id }`. A static port with `whileSet: 'field'` only exists while that field is set.
- `validate(config, { typeOf })` adds publish rules the schema can't state.
- `upgrade(data, fromVersion)` brings config written against an older `typeVersion` to the current one, so a pinned graph keeps running after you change a node type.

Use `.optional()` and `.nullable()` freely in a config schema. Don't use `.meta()`: in VineJS 4.4 it makes a scalar field accept `null`. Put editor hints in `fields`.

### Built-in nodes

| Type           | Ports                                               | Does                                                                                                                                                                                                     |
| -------------- | --------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `start`        | `default`                                           | The entry. One per graph.                                                                                                                                                                                |
| `message`      | `default`                                           | Says its text.                                                                                                                                                                                           |
| `question`     | `answered`, `timeout` while `timeoutMinutes` is set | Asks, waits, and reads the answer as `text`, `number`, `boolean`, `email` or `phone`. An answer that doesn't read re-asks up to `retries` times, then leaves through `answered` with the variable unset. |
| `condition`    | `true`, `false`                                     | Compares a variable with a value. The operators depend on the variable's type.                                                                                                                           |
| `set_variable` | `default`                                           | Renders a value and stores it as the variable's type. A value that doesn't read as that type leaves the variable unset.                                                                                  |
| `delay`        | `default`                                           | Waits for a number of seconds. Messages sent meanwhile answer nothing.                                                                                                                                   |
| `handoff`      | none                                                | Returns the ticket to its queue, or transfers it to a queue and optionally an attendant.                                                                                                                 |
| `close`        | none                                                | Closes the ticket with a close reason.                                                                                                                                                                   |
| `end`          | none                                                | Ends the run and returns the ticket to its queue.                                                                                                                                                        |

Text operators compare trimmed and case-insensitive: `equals`, `not_equals`, `contains`, `not_contains`, `starts_with` and `is_empty`. Number operators are `equals`, `not_equals`, `gt`, `gte`, `lt` and `lte`. Boolean operators are `is_true` and `is_false`. Every type also has `is_set` and `is_not_set`, the only operators that hold on an unset variable. `compare(value, operator, operand)` is the same function the `condition` node uses.

### Effect handlers

An effect's `handler` is a lazily imported class, made once through the container, so `@inject()` works. Its `delivery` decides when it runs:

```ts
// app/flows/add_tag_effect.ts
import type { TransactionClientContract } from '@adonisjs/lucid/types/database'
import type { EffectContext, InTransactionEffect } from '@enzopita/adonisjs-inbox-flows'

export default class AddTagEffect implements InTransactionEffect<{ tag: string }> {
  async apply(
    trx: TransactionClientContract,
    payload: { tag: string },
    { ticketId }: EffectContext,
  ) {
    await trx.table('contact_tags').insert({ ticket_id: ticketId, tag: payload.tag })
  }
}
```

- `in_transaction` runs `apply(trx, payload, context)` inside the transaction that commits the turn. It lands exactly once with the turn's replies, or rolls back with them. A throw rolls the whole turn back and the inbox retries it. Write only through `trx`, and do no network IO, since the transaction holds the ticket's row.
- `after_commit` gets a row in `inbox_flow_effects` in that same transaction. The bot calls `deliver(payload, { idempotencyKey, attempt, ... })` right after the commit, outside any transaction. A failure is retried by the tick with doubling delays, up to `EFFECT_POLICY.attempts` attempts, then the row is marked `failed`. A delivery owns its row for a lease, so a worker that dies mid-call means one more call: pass `idempotencyKey` to the remote side.

The payload is checked against the effect's schema before the handler runs.

## Catalog and checks

`nodes.catalog` is plain JSON for the editor. Per node type, it has the label, category, icon, ports, defaults, `typeVersion`, whether the node is the entry, a terminal or waits, and the config as JSON Schema with each field's hints under `x-ui`. It also lists the operators per variable type.

`checkGraph(catalog, graph, mode)` comes from `@enzopita/adonisjs-inbox-flows/graph`, which imports neither VineJS nor Lucid. The editor runs it in the browser on the catalog JSON and gets the same problems the server reports.

```ts
import { checkGraph } from '@enzopita/adonisjs-inbox-flows/graph'

const problems = checkGraph(catalog, graph, 'publish')
// [{ code: 'port_unconnected', severity: 'impediment', nodeId: 'n4', detail: 'invalid' }]
```

- `draft` reports what makes a graph malformed, so a half-built graph still saves. That covers duplicate ids, the start count, edges that dangle, point at the start, leave a terminal, use an unknown port or a port twice, and invalid or duplicate variables.
- `publish` also reports unknown node types and versions, unconnected ports, unreachable nodes, nodes with no way to an end, empty required fields, and variables a field binds that are undeclared or of the wrong type. A template that renders a variable some path never sets is a warning.

`nodes.check(graph, mode)` runs on the server. In `publish` mode it adds each config under its VineJS schema and each node's `validate` rule. `nodes.compile(graph)` upgrades the graph, runs the same checks, and returns a compiled graph or the problems.

## Running flows

### Authoring

`inboxFlows` is the service, from `@enzopita/adonisjs-inbox-flows/services/main` or the container. Every result is a union with an `outcome`, so a controller maps each one onto a status.

```ts
import inboxFlows from '@enzopita/adonisjs-inbox-flows/services/main'

const flow = await inboxFlows.flows.create('Sales screening')

await inboxFlows.drafts.save(flow.id, graph, flow.draftRevision)
// { outcome: 'saved', revision, problems } | { outcome: 'invalid', problems } | { outcome: 'stale', flow }

await inboxFlows.drafts.validate(flow.id) // every problem that blocks a publish

await inboxFlows.publish(flow.id, userId)
// { outcome: 'published', version } | { outcome: 'unchanged', version } | { outcome: 'invalid', problems } | { outcome: 'conflict' }
```

- `catalog()` is the registry's catalog plus `closeReasons` and the variables a binding condition can read, for the editor.
- `drafts.save(id, graph, revision)` saves over the revision the editor loaded. When someone saved in between, it answers `stale` with the flow as it is now. A malformed graph is `invalid`. An incomplete one saves, with its publish problems.
- `publish(id, publishedBy)` runs the strict checks, then checks that every field with a `queue` or `attendant` widget names a row that exists and every `close_reason` field names one of `config.closeReasons`, then runs `validatePublish`. A draft whose logic matches the published version, positions aside, is `unchanged`. Versions are immutable and numbered per flow.
- `versions.list(id)` lists them newest first. `versions.restore(id, versionId, revision)` copies one into the draft, under the same revision check. Publishing it makes a new version.

### Activation

A binding says which flow the bot starts on a ticket nobody started one on:

```ts
await inboxFlows.bindings.set(flow.id, [
  {
    priority: 10,
    channelId: whatsapp.id,
    queueId: null,
    condition: { variable: 'message', operator: 'contains', value: 'price' },
  },
  { priority: 0, channelId: whatsapp.id, queueId: null, condition: null },
])
```

`bindings.set` replaces the flow's bindings, and `bindings.list` reads them. On a turn with no live run, the bot takes the highest-priority binding of a published flow whose channel and queue match the ticket, or are `null`, and whose condition holds. The condition uses the operators of the `condition` node over `message`, the text of the waiting messages. The run is pinned to that flow's published version, and a later publish never moves it. When no binding matches, the bot returns the ticket to its queue.

The bot never starts a flow by binding on a ticket where an earlier run ended `handed_off`, `taken_over` or `stopped`. A person owns that ticket now.

### Manual start and stop

```ts
await inboxFlows.start(ticketId, flowId, actor)
// { outcome: 'started', run } | { outcome: 'rejected', reason }

await inboxFlows.stop(ticketId, actor)
// { outcome: 'stopped', run } | { outcome: 'not_running' }
```

`start` stores a `pending` run pinned to the flow's published version. A ticket the bot holds is woken. Any other ticket is assigned to the bot as `actor`, so `config.authorize` decides. A run already live on the ticket ends `replaced`. A manual start ignores the bindings and the rule above.

`stop` ends the live run `stopped` and returns the ticket when the bot holds it.

`runs.forTicket(ticketId)` lists a ticket's runs, oldest first.

### A person taking over

A person replying to a ticket the bot holds takes it in the same write, so a bot turn in flight fails its commit and sends nothing. The provider listens to `inbox:ticket_changed` and ends the run `taken_over`. The tick does the same for a change the listener missed, and the bot ends such a run itself if it ever gets the ticket back first.

## How a run is stored

A row of `inbox_flow_runs` is the only record of a run: its status, its pinned version, where it waits, its variables, when it is due, and why it ended. The bot keeps nothing in the inbox's `botState`.

| Writer                    | Runs in                                                   | Writes                                                                                                                                                        |
| ------------------------- | --------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| The bot's turn            | the inbox's ticket transaction, through `BotReply.within` | inserts a running or ended run from a binding; moves a run from `pending` or `running` to `running` or `ended`: `waiting`, `vars`, `wake_at`, the end columns |
| `start`                   | its own transaction                                       | inserts a `pending` run; ends the live one `replaced` or `taken_over`                                                                                         |
| `stop`                    | a single update                                           | ends the live run `stopped`                                                                                                                                   |
| The listener and the tick | a single update each                                      | end a live run `taken_over`, `ticket_closed` or `start_expired`                                                                                               |

- Every update compares and bumps `revision`. A bot turn whose run moved since it read it answers `stale`, and the inbox runs the turn again on a fresh read. The bot's turns already serialize on the ticket's row.
- `live_ticket_id` holds the ticket id while a run is `pending` or `running`, and `NULL` once it ended. Its plain unique index keeps one live run per ticket on every database, since `NULL`s never collide.
- A run's status, columns and end reason agree by CHECK constraints, so every stored row reads back as the `FlowRun` union.

A turn that ends `failed` or `step_budget_exhausted` commits what the run said before it ended and drops the turn's effects: a broken or looping graph would otherwise leave them half done.

## The tick

`node ace flows:tick`, or `inboxFlows.tick()`, works through at most `TICK_BATCH` rows of each kind:

- it ends the live runs whose ticket left the bot or closed, and the manual starts whose assign never landed by their deadline;
- it wakes the runs whose wait is due, and the manual starts the bot holds but never entered. A wake under `tasks.inline()` is a timer that a restart loses;
- it delivers the `after_commit` effects that are due, and retries the ones whose delivery died mid-call.

Each part decides from the rows as they are, and every wake carries a token for exactly one wait, so a second tick right after the first changes nothing.

## Running a turn

`runTurn(compiled, state, input)` is the interpreter. It takes the run state the caller stored and one trigger, and returns what to say and the next state. It does no IO.

```ts
const result = await nodes.compile(graph)
if (result.kind === 'invalid') throw new Error('not publishable')

let state: RunState = { status: 'fresh', vars: {} }

const outcome = runTurn(result.graph, state, {
  trigger: { kind: 'assigned' },
  unanswered: turn.unanswered,
  now: DateTime.now(),
})
```

The trigger is `assigned`, `message` or `wake` with a token. The outcome is one of these:

- `idle`, with a reason. Nothing changed and there is nothing to commit.
- `wait`, with `say`, `effects`, the new `state`, and `wake`. `wake` is the time to wake the run with its token, or `null` for a message wait without a timeout.
- `end`, with `say`, `effects`, the final `state`, the `reason` and a `handoff`. Every ending hands the ticket on: `return`, `transfer` or `close`.

A run only takes messages newer than the ones it had seen when its wait began. The message that opened the ticket never answers the first question, and a message sent during a delay never answers the question after it. Each wait gets its own token, so a late or duplicated wake does nothing.

At most 50 nodes run per turn by default. A graph that loops ends `step_budget_exhausted`. A node that throws, sets a variable to a value of another type, or leaves through a port it doesn't have ends the run `failed`. Both return the ticket to its queue instead of crashing the turn, and both keep what the run said before.
