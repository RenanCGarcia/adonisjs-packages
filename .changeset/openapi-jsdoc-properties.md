---
'@enzopita/adonisjs-openapi': minor
---

Read the doc comments of properties: the text becomes `description`, `@example` adds to `examples`, `@default` becomes `default` and `@deprecated` sets `deprecated: true`. `@example {200} name` on an action gives the body of that status an example, read from a `const` holding JSON. A value that cannot be read gets `OA-T009`.
