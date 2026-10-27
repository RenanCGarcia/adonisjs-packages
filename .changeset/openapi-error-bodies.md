---
'@enzopita/adonisjs-openapi': minor
---

Document error bodies and resolve `@throws` classes without importing them:

- Every error status without a body of its own, such as `@throws {404}` or the `401` of a secured route, gets the body the app's exception handler sends, as the `Error` schema. `errorResponse` in the config overrides it.
- A route middleware that answers with a status, such as `response.badRequest(body)` in a tenant middleware, documents that response.
- `@throws {import('#exceptions/x').default}` and `@requestBody {import('#types/x').Name}` resolve a type without an import in the controller.
- A `@throws` reason that wraps lines is joined into one line, the reasons of several tags on one status code are joined, and identical bodies in a `oneOf` appear once.

Document responses, schemas and parameters as the app sends them:

- Branches that answer with the same status code are merged into a `oneOf`. `return null` is a `204`, `response.redirect()` a `302` with a `Location` header, and `response.json()` keeps the status set before it.
- The handler's own response calls are read: `send()` or a helper without `return`, `abort()`, `abortIf()`, `abortUnless()`, `download()`, `attachment()` and `stream()`, and the headers it sets with a literal name. A string body is `text/plain`, or the literal `content-type` the handler sets.
- An exception thrown with `throw new X()` in a handler or a middleware documents its response. The `401` of a secured route gets the body of `E_UNAUTHORIZED_ACCESS`.
- A handler that only answers with errors no longer gets a `200`.
- A Lucid model becomes `{}` with a warning. `Map` and `Set` are empty objects, `bigint` is a string, and properties typed `undefined` or keyed by a symbol are left out.
- An object query parameter uses `style: deepObject`, an optional path parameter documents both paths, and each method of a route reads its own input.
- A `HEAD`-only route is left out, and a skipped closure route logs a warning.
