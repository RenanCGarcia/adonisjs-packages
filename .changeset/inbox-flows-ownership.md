---
'@enzopita/adonisjs-inbox': minor
'@enzopita/adonisjs-inbox-flows': minor
---

The flows bot honors the inbox's `config.ownership`. It only takes the bindings whose columns match what `ownership` returns for the ticket's channel, so a binding with no channel and no queue no longer starts one tenant's flow on another tenant's ticket when no tenant is in context, as in a webhook or a tick. The runs and effects it creates, and the runs `start` creates, get those columns too. The inbox exports `inbox.ownership(conversationId)` for a package that creates rows of its own for a conversation's tickets.
