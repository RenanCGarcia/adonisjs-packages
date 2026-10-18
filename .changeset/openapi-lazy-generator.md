---
'@enzopita/adonisjs-openapi': patch
---

Importing the package no longer loads the TypeScript compiler and `@adonisjs/assembler`, so `config/openapi.ts` no longer pulls them in when the app boots. `generateDocument()` loads them on its first call.
