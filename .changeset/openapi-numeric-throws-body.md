---
'@enzopita/adonisjs-openapi': patch
---

A numeric `@throws {403}` on a status that a route middleware also answers now adds the body the exception handler renders for that status to the `oneOf`, instead of keeping only the middleware bodies.
