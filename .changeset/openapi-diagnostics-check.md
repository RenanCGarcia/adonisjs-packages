---
'@enzopita/adonisjs-openapi': minor
---

`generateDocument()` returns `diagnostics` (`code`, `severity`, `route`, `message`, `fix`, `location`) instead of `warnings: string[]`, and `provenance`, which records where each response of each route comes from. `openapi:generate --explain=<route>` prints that provenance, and the new `openapi:check` command fails when the committed document is out of date. The generated document is unchanged.
