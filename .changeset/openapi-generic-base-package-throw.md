---
'@enzopita/adonisjs-openapi': patch
---

Find a `@throws {Class}` by name when the class extends a generic app class, such as `extends LocalizedException<'E_X'>`. It failed with `OA-T002`.

Document a package exception the app throws itself, such as `throw new errors.E_ROW_NOT_FOUND(Model)` or bouncer's `E_AUTHORIZATION_FAILURE`, with the status read from the package's JavaScript. It was left out of the document. A vine `E_VALIDATION_ERROR` thrown this way gets the `ValidationError` body the framework renders. A package class with a `handle()` of its own whose body is unknown now gets `OA-E002`, as it does when a preset names it.
