---
'@enzopita/adonisjs-openapi': patch
---

`components.schemas.ErrorCode` now lists a literal `code` that an error body reaches through a `$ref` to `components.schemas`, or through nested `oneOf` and `anyOf` entries. It used to read only inline bodies and their top-level `oneOf`.
