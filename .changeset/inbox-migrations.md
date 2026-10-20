---
'@enzopita/adonisjs-inbox': minor
---

Ship schema changes across versions as new migrations. The package lists its migrations in a manifest of stable ids, and a published file carries its id in its name, `<timestamp>_inbox_<id>_<name>.ts`. `configure` writes every migration the app lacks, and `node ace inbox:migrations` writes the ones a newer version adds, never opening a file the app has, with `--check` exiting with 1 when one is missing. The first use of a model whose columns are behind the migrations throws `InboxError` `E_INBOX_SCHEMA_OUTDATED`. `@enzopita/adonisjs-inbox/migrations` and `./migrations_command` export the mechanism for packages that build on the inbox, and `copyApp` in `./testing` copies an app to run migrations in.

The inbox migration stub rendered again: backticks in its comments broke the stub template, so `configure` failed to write it.
