---
'@enzopita/adonisjs-inbox': minor
---

`config.ownership` now also fills the stored webhooks (`inbox_channel_events`) and the ticket events the inbox creates from a channel, not only its contacts, conversations, tickets and messages. A host with a `NOT NULL` tenant column on those tables can run webhooks, bot turns and `inbox:tick` with no tenant in context. Models in those roles need the columns `ownership` returns.
