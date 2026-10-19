# @enzopita/adonisjs-inbox

A helpdesk inbox runtime for AdonisJS 7. Contacts write in through channels, their messages land in conversations, and each stretch of attendance is a ticket that moves between queues and attendants. Attendants are humans or bots.

> v1 is in progress and nothing here is ready for an app yet. There is no provider, no service, no models and no migration.

## What exists

- The domain types, from `@enzopita/adonisjs-inbox/types` and the package root: branded ids, attendants and actors, the ticket state as a sum type, gestures, ticket facts, rejections and message statuses.
- `MODEL_ROLES`, the list of the ten models an app will own.
- `InboxError`, thrown for broken config and programmer errors, with a stable `code`.
