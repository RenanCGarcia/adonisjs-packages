---
'@enzopita/adonisjs-inbox': minor
---

Add channels and messages. `inbox.ingest` verifies a webhook through the channel's adapter, stores it and queues its processing, which creates the contact, conversation and ticket on first contact, dedupes repeated messages and moves statuses forward only. `inbox.messages.send` stores the reply pending in the ticket's compare-and-swap and dispatches it after the commit through a leased outbox, once per `clientRef`. Message content is the `MessageContent` union, only `{ kind: 'text' }` for now, and adapters declare the kinds they send as capabilities. The adapter port reserves optional `connect`, `disconnect` and `checkHealth` members, and channels gain a `status` column. Post-commit work runs through `tasks.inline()` or `tasks.queue()`, and `inbox.recover()` queues again the work a lost task left behind. `@enzopita/adonisjs-inbox/testing` exports a fake adapter and the adapter contract suite.
