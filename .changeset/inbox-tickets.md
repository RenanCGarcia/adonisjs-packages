---
'@enzopita/adonisjs-inbox': minor
---

Add the models and the ticket runtime. `node ace configure` registers the provider and writes `config/inbox.ts`, one migration with the `inbox_*` tables and their CHECK constraints, and ten models composed with the mixins from `@enzopita/adonisjs-inbox/mixins`. The `inbox` service applies ticket gestures through a compare-and-swap on the ticket version, records ticket events, marks tickets read, opens tickets, manages attendants and queue members, and returns an attendant's tickets to the queue when it is deactivated or leaves the queue. `defineConfig` takes the models, the bot keys, an `authorize` hook and an `ownership` hook.
