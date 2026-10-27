---
'@enzopita/adonisjs-openapi': major
---

Each tag has one meaning, and a body comes from an exception class, never from a status code.

- `@throws {Class}` takes one class, found in scope or by name in `app/**/exceptions/`. `@throws {404}`, `@throws {A | B}` and a tag without braces fail generation (`OA-T001`), as does a class name that none or several classes have (`OA-T002`).
- `@response {N} reason` describes a status the generator documents, and fails generation when nothing does (`OA-T003`). `@response {N} {Type} reason` declares a status and its body, and fails generation when the type does not resolve (`OA-T007`).
- `errors.throwers` names the exception a call throws inside a package, such as `bouncer.authorize` or `findOrFail`, and `errors.middleware` the one a package middleware throws, by its name in `node ace list:routes`, such as the limiter's `globalThrottle`. A key that matches nothing gets the `OA-E003` warning. An entry's status is read from the source of its class, which the generator never runs.
- `errors.body` replaces `errorResponse`, and `defineConfig()` throws when a config still passes `errorResponse`.
- An exception's body is the one an `instanceof` branch of the exception handler renders for its class, else the exception's own, else the handler's generic body. A branch that sends nothing does not count, and a condition of `instanceof` checks joined by `||` makes a branch for each class. The handler's bodies are no longer matched to a status code.
- The `401` of a secured route is the response of `E_UNAUTHORIZED_ACCESS`, so a branch of the exception handler for it now gives its body.
- `download()` and `attachment()` are documented with the media type of a literal file extension (#20).
- An error diagnostic makes `openapi:generate` and `openapi:check` exit with code 1, and `openapi:generate` writes no file. An unknown tag gets the `OA-T008` warning. Standard JSDoc tags such as `@internal` or `@todo` do not.
