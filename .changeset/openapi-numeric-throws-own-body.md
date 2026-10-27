---
'@enzopita/adonisjs-openapi': patch
---

A numeric `@throws {status}` adds the exception handler's body only when the action sends no body of its own for that status. In 0.4.1 it also added that body next to an exception the action throws, such as a `409` with its own body, which documented bodies the route never sends.
