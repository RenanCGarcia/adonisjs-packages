---
'@enzopita/adonisjs-inbox': patch
---

An inbox model now typechecks with your own mixin composed after the inbox's, such as `compose(InboxTicketSchema, withInboxTicket(), withTenantScope())`. The attendant model's `botKey` column is typed `string | null`, since `BotKey` comes from your config, whose type depends on the models. `asAttendant` still types a bot's key as a `BotKey`.
