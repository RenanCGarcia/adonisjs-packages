---
'@enzopita/adonisjs-openapi': patch
---

`@exception` is no longer read as `@throws`. It now gets `OA-T008 ... use @throws {Class}`, as the README documents, and no response is documented from it. Under `strict` this warning fails the generation.
