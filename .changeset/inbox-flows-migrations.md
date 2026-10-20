---
'@enzopita/adonisjs-inbox-flows': minor
---

Ship schema changes across versions as new migrations, as the inbox does. `configure` writes every flows migration the app lacks, named `<timestamp>_inbox_flows_<id>_<name>.ts`, `node ace flows:migrations` writes the ones a newer version adds, with `--check` for CI, and a flows model whose columns are behind the migrations throws `InboxError` `E_INBOX_SCHEMA_OUTDATED` on first use.
